// The Mac's own translator, as a command-line helper.
//
// macOS translates on-device, for free, with models Apple ships and updates. It is a
// better translator than anything we can bundle, and it costs the user no download from
// us. The catch is the shape of the API: a `TranslationSession` can only be obtained from
// SwiftUI's `.translationTask` modifier, so using it means having a view, an app object
// and a run loop. That does not fit inside a Rust function, so it lives here instead and
// the app talks to it over stdin and stdout.
//
// Protocol, one request per run:
//   stdin:  {"source": "nb", "target": "sv", "text": "…"}   (source may be omitted)
//   stdout: {"ok": true, "text": "…"}  or  {"ok": false, "error": "…"}
//
// Exit code is 0 whenever an answer was written, including a refusal. Anything else means
// the helper itself failed and the caller should fall back to the bundled model.

import AppKit
import Foundation
import SwiftUI
import Translation

struct Request: Decodable {
    let source: String?
    let target: String
    let text: String
}

struct Reply: Encodable {
    let ok: Bool
    var text: String?
    var error: String?
}

func emit(_ reply: Reply) -> Never {
    let data = (try? JSONEncoder().encode(reply)) ?? Data("{\"ok\":false,\"error\":\"encode\"}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

func fail(_ message: String) -> Never {
    emit(Reply(ok: false, text: nil, error: message))
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let request = try? JSONDecoder().decode(Request.self, from: input) else {
    fail("could not read the request")
}

// Paragraph breaks do not survive a single translation call intact, so each paragraph is
// its own request and the joins are put back exactly as they were. Apple's API takes a
// batch, which keeps this to one round trip.
let paragraphs = request.text.components(separatedBy: "\n\n")

/// A view that exists only to own a translation session. Never seen by anyone.
struct Worker: View {
    let request: Request
    let paragraphs: [String]
    @State private var configuration: TranslationSession.Configuration?

    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            .translationTask(configuration) { session in
                do {
                    // A pair the Mac does not know is a plain "no", so the caller can fall
                    // back at once instead of waiting for the watchdog.
                    if let source = request.source {
                        let status = await LanguageAvailability().status(
                            from: Locale.Language(identifier: source),
                            to: Locale.Language(identifier: request.target)
                        )
                        if status == .unsupported {
                            fail("this Mac cannot translate that language pair")
                        }
                    }

                    let requests = paragraphs.enumerated().map {
                        TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset))
                    }
                    let responses = try await session.translations(from: requests)

                    // Responses may arrive in any order; the client identifier is the only
                    // thing tying one back to the paragraph it came from.
                    var byIndex = [Int: String]()
                    for response in responses {
                        if let id = response.clientIdentifier, let index = Int(id) {
                            byIndex[index] = response.targetText
                        }
                    }
                    let joined = paragraphs.indices
                        .map { byIndex[$0] ?? paragraphs[$0] }
                        .joined(separator: "\n\n")
                    emit(Reply(ok: true, text: joined, error: nil))
                } catch {
                    fail("\(error.localizedDescription)")
                }
            }
            .onAppear {
                configuration = TranslationSession.Configuration(
                    source: request.source.map { Locale.Language(identifier: $0) },
                    target: Locale.Language(identifier: request.target)
                )
            }
    }
}

class Delegate: NSObject, NSApplicationDelegate {
    let request: Request
    let paragraphs: [String]
    var window: NSWindow?

    init(request: Request, paragraphs: [String]) {
        self.request = request
        self.paragraphs = paragraphs
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // The view has to be in a window that the system considers live, or the task never
        // runs. Off the edge of the screen and fully transparent is the closest thing to
        // not existing that still counts as live.
        let window = NSWindow(
            contentRect: NSRect(x: -10_000, y: -10_000, width: 1, height: 1),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.alphaValue = 0
        window.contentView = NSHostingView(rootView: Worker(request: request, paragraphs: paragraphs))
        window.orderFrontRegardless()
        self.window = window
    }
}

// Never hang. The framework can wait on a language download, or on a consent dialog that
// has nowhere to appear, and a mail client must not sit there forever because of it. The
// caller falls back to the bundled model when this fires.
DispatchQueue.global().asyncAfter(deadline: .now() + 25) {
    fail("the Mac's translator did not answer in time")
}

let app = NSApplication.shared
// Accessory, so the helper never shows up in the Dock or steals focus.
app.setActivationPolicy(.accessory)
let delegate = Delegate(request: request, paragraphs: paragraphs)
app.delegate = delegate
app.run()
