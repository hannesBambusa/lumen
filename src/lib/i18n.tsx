import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * The app's own words, in the language of the machine it runs on.
 *
 * One object per language, typed against English so a missing string is a build error
 * rather than an English word on a Swedish screen. Anything with a number or a name in it
 * is a function, because word order and plurals differ between the three.
 *
 * Only the interface is translated here. Mail is shown as written, and the translation
 * feature is the assistant's job.
 */
export type Locale = "en" | "sv" | "nb";

/** What the user chose in Settings. "system" follows the machine and is the default. */
export type LocaleChoice = Locale | "system";

export const LOCALES: Array<{ id: Locale; name: string }> = [
  { id: "en", name: "English" },
  { id: "sv", name: "Svenska" },
  { id: "nb", name: "Norsk" },
];

const CHOICE_KEY = "lumen.locale";

/** BCP 47 tags for date and time formatting. */
const TAGS: Record<Locale, string> = { en: "en-GB", sv: "sv-SE", nb: "nb-NO" };

/**
 * The English name of a language, for prompts.
 *
 * The model is prompted in English throughout, so the app's language has to reach it under
 * the name it knows. Separate from the display names, which are for people.
 */
export function modelLanguage(locale: Locale): string {
  switch (locale) {
    case "sv":
      return "Swedish";
    case "nb":
      return "Norwegian";
    default:
      return "English";
  }
}

export function detectLocale(): Locale {
  const wanted = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language];
  for (const tag of wanted) {
    const lang = tag.toLowerCase().split("-")[0];
    if (lang === "sv") return "sv";
    // Nynorsk users get Bokmål rather than English: closer by a long way.
    if (lang === "nb" || lang === "nn" || lang === "no") return "nb";
    if (lang === "en") return "en";
  }
  return "en";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const en = {
  /** Names of the languages Translate can target, keyed by the English name the model gets. */
  languages: {
    English: "English",
    Swedish: "Swedish",
    Norwegian: "Norwegian",
    Danish: "Danish",
    German: "German",
    French: "French",
    Spanish: "Spanish",
  } as Record<string, string>,

  common: {
    you: "You",
    youLower: "you",
    unknown: "Unknown",
    noSubject: "(no subject)",
    close: "Close",
    messages: (n: number) => plural(n, "message", "messages"),
    files: (n: number) => plural(n, "file", "files"),
    justNow: "just now",
    hours: (n: number) => plural(n, "hour", "hours"),
    days: (n: number) => plural(n, "day", "days"),
    weeks: (n: number) => plural(n, "week", "weeks"),
    months: (n: number) => plural(n, "month", "months"),
    ago: (span: string) => `${span} ago`,
    onDevice: "On this device. Nothing was sent anywhere.",
  },

  app: {
    folders: { inbox: "Inbox", sent: "Sent", drafts: "Drafts", archive: "Archive", trash: "Trash" },
    opening: "Opening your mailbox…",
    fetching: "Fetching mail…",
    approve: "Approve Lumen in the browser window that just opened.",
    connected: "Connected. Fetching your mail, this takes a moment…",
    sections: "Sections",
    brandTitle: "Working name, not final",
    view: "View",
    mail: "Mail",
    people: "People",
    files: "Files",
    settings: "Settings",
    checking: "Checking…",
    syncNow: "Sync now",
    signInAgain: "Sign in to Google again",
    checkedAt: (time: string) => `Checked ${time}`,
    resizeSidebar: "Resize the sidebar",
    resizeList: "Resize the list",
    resizeMessageList: "Resize the message list",
    message: "Message",
    selectMessage: "Select a message.",
    selectSomeone: "Select someone.",
    syncPartial: (stored: number, fetched: number) =>
      `Got ${stored} of ${fetched} new messages before stopping.`,
    upToDate: "Up to date, nothing new.",
    newMessages: (n: number) => `${plural(n, "new message", "new messages")}.`,
  },

  connect: {
    title: "Your mail, on your machine",
    lede:
      "Lumen keeps a copy of your mailbox locally, so it is fast, searchable and works offline. There is no Lumen server and nothing is sent anywhere else.",
    waiting: "Waiting for Google…",
    button: "Connect Google account",
    fact1: "Your browser opens on Google's own sign-in page. Lumen never sees your password.",
    fact2: "Access can be withdrawn at any time at myaccount.google.com/permissions.",
    fact3: "Lumen asks to read, organise and send mail. It cannot delete anything permanently.",
    fine: "While the app is unverified by Google you will see a warning screen. Continue past it: only accounts on the test-user list can get this far.",
  },

  list: {
    messagesAria: "Messages",
    conversations: (n: number) => plural(n, "conversation", "conversations"),
    searchPlaceholder: "Search people, addresses and subjects",
    matchedOn: "Also on this:",
    openPerson: (name: string) => `All mail exchanged with ${name}`,
    searchAria: "Search mail by person, address or subject",
    searchCount: (n: number) => `${plural(n, "conversation", "conversations")}, all folders`,
    noMatches: (query: string) => `Nothing matches “${query}”. This searches people, addresses and subjects, not what is written in the mail.`,
    reader: "Reader",
    nothingIn: (folder: string) => `Nothing in ${folder}.`,
    people: "People",
    machines: "Machines",
    noMessages: "No messages",
    mailFrom: (name: string) => `Mail from ${name}`,
    sentByYou: "Sent by you",
    received: "Received",
    toYou: "To you",
    toYouAnd: (n: number) => `To you and ${plural(n, "other", "others")}`,
    copiedToYou: "Copied to you",
    copiedToYouAnd: (n: number) => `Copied to you and ${plural(n, "other", "others")}`,
  },

  category: {
    all: "All",
    label: (name: string) => `AI category: ${name}`,
    byModel: "Decided by the model",
    byRule: "Decided by a rule, not the model",
    byYou: "You put it here",
    descriptionNote: "The assistant reads these in English: sorting was measured with translated descriptions and it got noticeably worse. Reword one and your wording is what it reads.",
    description: {
      reply: "a person is asking me for something, or expects an answer from me",
      fyi: "a person wrote to me, but nothing is being asked of me",
      meeting: "a meeting invitation, or arranging a time",
      invoice: "an invoice, a receipt, a payment or an order confirmation",
      automated: "an automatic notification from a system or service",
      newsletter: "marketing, campaigns, product news sent to many people",
    } as Record<string, string | undefined>,
    pick: "Category",
    unsorted: "Not sorted",
    manage: "Categories",
    manageLede: "What mail is sorted into. Rename them, add your own, or stop the assistant using one. The description is what the assistant sorts by, so a vague one sorts badly.",
    newName: "Name",
    newDescription: "Describe it for the assistant",
    add: "Add category",
    save: "Save",
    remove: "Remove",
    builtin: "built in",
    autoSort: "The assistant may sort into this",
    manualOnly: "Only you put mail here",
    tooMany: (n: number) => `The assistant uses the first ${n}. More than that and it starts confusing them.`,
    resort: "Sort the mailbox again",
    resortLede: "Throws away what the rules and the assistant decided, and sorts again. What you set by hand is kept.",
    removeWarning: "Mail in it becomes unsorted.",
    noneOfKind: "Nothing in that category.",
    sorting: (done: number, total: number) => `Sorting ${done} of ${total}… stop`,
    sortAll: (n: number) => `Sort ${n} messages`,
    needsAi: (n: number) => `${n} unsorted. Sorting needs the AI switched on.`,
    sortMore: (n: number) => `Sort ${n} more`,
    name: {
      reply: "Needs a reply",
      fyi: "For information",
      meeting: "Meetings",
      invoice: "Invoices",
      automated: "Notifications",
      newsletter: "Newsletters",
    } as Record<string, string | undefined>,
  },

  drafts: {
    inLumen: "Draft in Lumen",
    inGmail: "draft in Gmail",
    onlyHere: "Only on this computer, in Lumen",
    savedHere: "This draft is kept in Lumen on this computer, not in Gmail.",
    discard: "Delete draft",
  },

  message: {
    from: "From",
    to: "To",
    cc: "Cc",
    attachments: (n: number) => plural(n, "attachment", "attachments"),
    andMore: (n: number) => `and ${n} more`,
    copiedTo: (n: number) => `Copied to ${plural(n, "person", "people")}`,
  },

  things: {
    title: "Files",
    sub: "Everything that ever arrived, without hunting for the mail it came in.",
    filters: {
      all: "Everything",
      pdf: "PDFs",
      sheet: "Sheets",
      image: "Images",
      doc: "Docs",
      archive: "Archives",
    } as Record<string, string>,
    searchPlaceholder: "Search file names and senders",
    searchAria: "Search files by name or sender",
    clear: "Clear",
    clearSearch: "Clear search",
    matching: (n: number, query: string) => `${plural(n, "file", "files")} matching “${query}”`,
    nothingMatches: (query: string) => `Nothing matches “${query}”.`,
    noneOfKind: "No files of that kind.",
    thisWeek: "This week",
    earlier: "Earlier",
  },

  thread: {
    people: (n: number) => `${n} people`,
    hideSummary: "Hide summary",
    summarise: "Summarise",
    closeReply: "Close reply",
    reply: "Reply",
    threadView: "Thread view",
    reading: "Reading",
    timeline: "Timeline",
    daysEarlier: (n: number) => `${n} days earlier`,
    weeksEarlier: (n: number) => `${n} weeks earlier`,
    monthsEarlier: (n: number) => `${plural(n, "month", "months")} earlier`,
    hideSignature: "Hide signature",
    signature: "Signature",
    hideEarlier: "Hide earlier messages",
    showEarlier: (n: number) => `Show ${plural(n, "earlier message", "earlier messages")}`,
    nothingWritten: "Nothing was written in this conversation.",
  },

  body: {
    translatingTo: (language: string) => `Translating to ${language}…`,
    translatedTo: (language: string) => `Translated to ${language}`,
    translating: "Translating…",
    hideTranslation: "Hide translation",
    translateTo: (language: string) => `Translate to ${language}`,
    loading: "Loading…",
    readingView: "Reading view",
    showOriginal: "Show original",
    imagesBlocked: "Images are blocked. Loading them tells the sender you opened this.",
    alwaysShowFromSender: "Always show from this sender",
    showImages: "Show images",
    messageContent: "Message content",
    summarising: "Summarising…",
    summaryStale: "New messages since. Summarise again",
    summaryOutOfDate: "Summary, out of date",
    summaryCollapse: "Fold away",
    summaryExpand: "Show the summary",
    summarisedAt: (when: string) => `Made ${when}`,
    sinceThen: (n: number) => `${n} ${n === 1 ? "message" : "messages"} since`,
    summary: "Summary",
  },

  preview: {
    needsApp: "Previews need the desktop app; there is nothing to fetch from in a browser.",
    fetching: "Fetching…",
    rendering: "Rendering…",
    pdfFailed: "This PDF could not be rendered.",
    page: (n: number) => `Page ${n}`,
    rowsCols: (rows: number, cols: number) => `${rows} rows · ${cols} columns`,
    firstRows: (shown: number, total: number) => `Showing the first ${shown} of ${total} rows.`,
    firstPages: (shown: number, total: number) => `Showing the first ${shown} of ${total} pages.`,
  },

  writing: {
    reply: "Reply",
    re: (subject: string) => `Re: ${subject}`,
    placeholder: "Write your reply…",
    fixed: "Fixed spelling and grammar",
    fixing: "Fixing spelling and grammar…",
    improved: "Improved",
    improving: "Improving…",
    translated: "Translated",
    translating: "Translating…",
    useThis: "Use this",
    discard: "Discard",
    fix: "Fix spelling & grammar",
    improve: "Improve",
    translateTo: "Translate to",
    translationLanguage: "Translation language",
    turnOn: "Turn on the writing assistant in Settings to fix, improve or translate this.",
    notBuilt: "Sending is not built yet. Drafts are kept on this device.",
  },

  assistant: {
    downloading: (name: string, percent: number) => `Downloading ${name} · ${percent}%`,
    off: "Assistant off",
    noModel: "Assistant on · no model chosen",
    paused: (name: string) => `${name} download paused`,
    notDownloaded: (name: string) => `Assistant on · ${name} not downloaded`,
    failed: (name: string) => `${name} · download failed`,
    ready: (name: string) => `Assistant ready · ${name}`,
    plain: "Assistant",
    openSettings: "Open settings",
    aiOn: "AI is on",
    aiOff: "AI is off",
    tapToTurnOn: "Not running. Click to turn it on.",
    noModelChosen: "On, but no model chosen",
    downloadingShort: (name: string, percent: number) => `Downloading ${name} · ${percent}%`,
    pausedShort: (name: string) => `${name} paused`,
    failedShort: (name: string) => `${name} failed to download`,
    notDownloadedShort: (name: string) => `On, but ${name} is not downloaded`,
  },

  settings: {
    title: "Settings",
    tabGeneral: "General",
    mailWindow: "Mail to keep",
    mailWindowLede: "How far back a sync reaches. Everything newer than this is downloaded and kept on this computer; older mail stays in Gmail until you widen this.",
    fetchBack: "Fetch mail from the last",
    fetchBackDesc: "A wider window means a much longer first sync.",
    window: { "30": "30 days", "60": "60 days", "180": "6 months", "365": "1 year", "0": "Everything" } as Record<string, string>,
    appearance: "Appearance",
    appearanceLede: "How the app looks. Six palettes, or follow the computer between the light and dark one.",
    textSize: "Text size",
    textSizeDesc: "Scales every piece of text in the app.",
    size: { small: "Small", normal: "Normal", large: "Large", huge: "Largest" } as Record<string, string>,
    theme: { paper: "Paper", snow: "Snow", sand: "Sand", slate: "Slate", ink: "Ink", midnight: "Midnight" } as Record<string, string>,
    tabAi: "AI",
    sub: "Everything here stays on this device.",
    language: "Language",
    languageLede: "The words in the app itself. Mail is shown as written.",
    appLanguage: "App language",
    system: "Same as the computer",
    assistant: "Writing assistant",
    assistantLede:
      "Small language models that run inside Lumen. They translate, fix and improve text without sending anything anywhere. Each needs a one-time download and a few gigabytes of memory while in use.",
    useAssistant: "Use the assistant",
    on: "On. Features below appear where they apply once the chosen model is downloaded.",
    off: "Off. Nothing runs and nothing appears in the app.",
    writingModel: "Writing model",
    writingModelLede:
      "Does the fixing, improving and summarising, and translation unless a specialist is chosen below. Pick one; download it; the others can stay on disk or be removed.",
    translationModel: "Translation model",
    translationModelLede:
      "A translation-only model, if you want better translations than the writing model gives. When downloaded and chosen, Translate uses it; everything else still uses the writing model.",
    translateWith: "Translate with",
    appleTranslation: "Your Mac's built-in translation",
    translationLedeMac:
      "This Mac translates on its own, on-device, with nothing to download. It is better at Nordic languages than a model this size and it is the default here. A translation model is the alternative if you would rather not use it; anything else still runs on the writing model.",
    theWritingModel: "The writing model",
    notDownloaded: "not downloaded",
    translateInto: "Translate into",
    translateIntoDesc: "The language Translate buttons use everywhere.",
    features: "Features",
    featuresLede: "Each one is a separate switch. Turn off anything you would rather the model did not touch.",
    feature: {
      translate: { name: "Translate", desc: "A Translate button on every message and in the reply drawer." },
      proofread: {
        name: "Fix spelling and grammar",
        desc: "Corrects a draft without changing its wording, tone or language.",
      },
      improve: {
        name: "Improve writing",
        desc: "Rewrites a draft to be clearer and better structured. Same meaning, same language.",
      },
      summarize: {
        name: "Summarise threads",
        desc: "A few sentences on what a long conversation is about and what it still needs.",
      },
    },
    model: {
      inUse: "in use",
      missing: "Not downloaded.",
      downloading: (done: string, total: string) => `Downloading: ${done} of ${total}`,
      perSecond: (speed: string) => `${speed}/s`,
      left: (time: string) => `about ${time} left`,
      paused: (done: string, total: string) => `Paused at ${done} of ${total}. Resume continues from here.`,
      ready: "Downloaded.",
      loaded: "Downloaded and loaded in memory.",
      error: "Something went wrong.",
      useThis: "Use this model",
      download: (size: string) => `Download ${size}`,
      resume: "Resume",
      cancelDelete: "Cancel and delete partial file",
      pause: "Pause",
      cancel: "Cancel",
      remove: "Remove from disk",
      seconds: (n: number) => `${n}s`,
      minutes: (n: number) => `${n} min`,
      hours: (n: number) => `${n} h`,
      blurbs: {
        "qwen3-1.7b":
          "Small. Runs on any laptop, about 1.5 GB of memory. Fine for fixing and improving text; translation between close languages is rough.",
        "qwen3-4b":
          "Better. Noticeably more accurate at everything, about 3 GB of memory. Slow on a laptop without a GPU.",
        "translategemma-4b":
          "Translation only. Google's translation-trained Gemma, 55 languages. Used for Translate when downloaded; the writing model does the rest.",
      } as Record<string, string>,
    },
  },
};

export type Strings = typeof en;

const sv: Strings = {
  languages: {
    English: "Engelska",
    Swedish: "Svenska",
    Norwegian: "Norska",
    Danish: "Danska",
    German: "Tyska",
    French: "Franska",
    Spanish: "Spanska",
  },

  common: {
    you: "Du",
    youLower: "dig",
    unknown: "Okänd",
    noSubject: "(inget ämne)",
    close: "Stäng",
    messages: (n) => plural(n, "meddelande", "meddelanden"),
    files: (n) => plural(n, "fil", "filer"),
    justNow: "nyss",
    hours: (n) => plural(n, "timme", "timmar"),
    days: (n) => plural(n, "dag", "dagar"),
    weeks: (n) => plural(n, "vecka", "veckor"),
    months: (n) => plural(n, "månad", "månader"),
    ago: (span) => `för ${span} sedan`,
    onDevice: "På den här datorn. Inget skickades någonstans.",
  },

  app: {
    folders: { inbox: "Inkorg", sent: "Skickat", drafts: "Utkast", archive: "Arkiv", trash: "Papperskorg" },
    opening: "Öppnar din brevlåda…",
    fetching: "Hämtar mejl…",
    approve: "Godkänn Lumen i webbläsarfönstret som just öppnades.",
    connected: "Ansluten. Hämtar dina mejl, det tar en stund…",
    sections: "Avsnitt",
    brandTitle: "Arbetsnamn, inte slutgiltigt",
    view: "Vy",
    mail: "Mejl",
    people: "Personer",
    files: "Filer",
    settings: "Inställningar",
    checking: "Kollar…",
    syncNow: "Synka nu",
    signInAgain: "Logga in på Google igen",
    checkedAt: (time) => `Kollade ${time}`,
    resizeSidebar: "Ändra sidopanelens bredd",
    resizeList: "Ändra listans bredd",
    resizeMessageList: "Ändra meddelandelistans bredd",
    message: "Meddelande",
    selectMessage: "Välj ett meddelande.",
    selectSomeone: "Välj någon.",
    syncPartial: (stored, fetched) => `Hämtade ${stored} av ${fetched} nya meddelanden innan det stannade.`,
    upToDate: "Uppdaterat, inget nytt.",
    newMessages: (n) => `${plural(n, "nytt meddelande", "nya meddelanden")}.`,
  },

  connect: {
    title: "Din mejl, på din dator",
    lede:
      "Lumen sparar en kopia av din brevlåda lokalt, så den är snabb, sökbar och fungerar offline. Det finns ingen Lumen-server och inget skickas någon annanstans.",
    waiting: "Väntar på Google…",
    button: "Anslut Google-konto",
    fact1: "Din webbläsare öppnar Googles egen inloggningssida. Lumen ser aldrig ditt lösenord.",
    fact2: "Åtkomsten kan tas bort när som helst på myaccount.google.com/permissions.",
    fact3: "Lumen ber om att få läsa, sortera och skicka mejl. Den kan inte radera något permanent.",
    fine: "Så länge appen inte är verifierad av Google visas en varningssida. Fortsätt förbi den: bara konton på testanvändarlistan kommer så långt.",
  },

  list: {
    messagesAria: "Meddelanden",
    conversations: (n) => plural(n, "konversation", "konversationer"),
    searchPlaceholder: "Sök personer, adresser och ämnen",
    matchedOn: "Även med här:",
    openPerson: (name) => `All post utbytt med ${name}`,
    searchAria: "Sök post på person, adress eller ämne",
    searchCount: (n) => `${plural(n, "konversation", "konversationer")}, alla mappar`,
    noMatches: (query) => `Inget matchar “${query}”. Den här sökningen gäller personer, adresser och ämnen, inte det som står i posten.`,
    reader: "Läsvy",
    nothingIn: (folder) => `Inget i ${folder.toLowerCase()}.`,
    people: "Personer",
    machines: "Maskiner",
    noMessages: "Inga meddelanden",
    mailFrom: (name) => `Mejl från ${name}`,
    sentByYou: "Skickat av dig",
    received: "Mottaget",
    toYou: "Till dig",
    toYouAnd: (n) => `Till dig och ${plural(n, "annan", "andra")}`,
    copiedToYou: "Kopia till dig",
    copiedToYouAnd: (n) => `Kopia till dig och ${plural(n, "annan", "andra")}`,
  },

  category: {
    all: "Alla",
    label: (name) => `AI-kategori: ${name}`,
    byModel: "Avgjord av modellen",
    byRule: "Avgjord av en regel, inte av modellen",
    byYou: "Du la den här",
    descriptionNote: "Assistenten läser de här på engelska: sortering mättes med översatta beskrivningar och blev märkbart sämre. Skriv om en så är det dina ord den läser.",
    description: {
      reply: "en person ber mig om något, eller väntar sig ett svar från mig",
      fyi: "en person har skrivit till mig, men inget efterfrågas av mig",
      meeting: "en mötesinbjudan, eller att boka en tid",
      invoice: "en faktura, ett kvitto, en betalning eller en orderbekräftelse",
      automated: "en automatisk avisering från ett system eller en tjänst",
      newsletter: "marknadsföring, kampanjer, produktnyheter som skickats till många",
    } as Record<string, string | undefined>,
    pick: "Kategori",
    unsorted: "Osorterad",
    manage: "Kategorier",
    manageLede: "Det posten sorteras i. Byt namn, lägg till egna, eller låt assistenten slippa någon. Beskrivningen är det assistenten sorterar efter, så en vag beskrivning sorterar dåligt.",
    newName: "Namn",
    newDescription: "Beskriv den för assistenten",
    add: "Lägg till kategori",
    save: "Spara",
    remove: "Ta bort",
    builtin: "inbyggd",
    autoSort: "Assistenten får sortera hit",
    manualOnly: "Bara du lägger post här",
    tooMany: (n) => `Assistenten använder de ${n} första. Fler än så börjar den blanda ihop dem.`,
    resort: "Sortera om posten",
    resortLede: "Kastar det reglerna och assistenten kom fram till och sorterar om. Det du satt för hand behålls.",
    removeWarning: "Post i den blir osorterad.",
    noneOfKind: "Inget i den kategorin.",
    sorting: (done, total) => `Sorterar ${done} av ${total}… stoppa`,
    sortAll: (n) => `Sortera ${n} meddelanden`,
    needsAi: (n) => `${n} osorterade. Sortering kräver att AI är påslaget.`,
    sortMore: (n) => `Sortera ${n} till`,
    name: {
      reply: "Kräver svar",
      fyi: "Till kännedom",
      meeting: "Möten",
      invoice: "Fakturor",
      automated: "Notiser",
      newsletter: "Nyhetsbrev",
    },
  },

  drafts: {
    inLumen: "Utkast i Lumen",
    inGmail: "utkast i Gmail",
    onlyHere: "Bara på den här datorn, i Lumen",
    savedHere: "Utkastet sparas i Lumen på den här datorn, inte i Gmail.",
    discard: "Ta bort utkastet",
  },

  message: {
    from: "Från",
    to: "Till",
    cc: "Kopia",
    attachments: (n) => plural(n, "bilaga", "bilagor"),
    andMore: (n) => `och ${n} till`,
    copiedTo: (n) => `Kopia till ${plural(n, "person", "personer")}`,
  },

  things: {
    title: "Filer",
    sub: "Allt som någonsin kommit in, utan att leta efter mejlet det satt i.",
    filters: { all: "Allt", pdf: "PDF", sheet: "Kalkylblad", image: "Bilder", doc: "Dokument", archive: "Arkiv" },
    searchPlaceholder: "Sök filnamn och avsändare",
    searchAria: "Sök filer på namn eller avsändare",
    clear: "Rensa",
    clearSearch: "Rensa sökningen",
    matching: (n, query) => `${plural(n, "fil", "filer")} matchar “${query}”`,
    nothingMatches: (query) => `Inget matchar “${query}”.`,
    noneOfKind: "Inga filer av den sorten.",
    thisWeek: "Den här veckan",
    earlier: "Tidigare",
  },

  thread: {
    people: (n) => `${n} personer`,
    hideSummary: "Dölj sammanfattning",
    summarise: "Sammanfatta",
    closeReply: "Stäng svaret",
    reply: "Svara",
    threadView: "Trådvy",
    reading: "Läsning",
    timeline: "Tidslinje",
    daysEarlier: (n) => `${n} dagar tidigare`,
    weeksEarlier: (n) => `${n} veckor tidigare`,
    monthsEarlier: (n) => `${plural(n, "månad", "månader")} tidigare`,
    hideSignature: "Dölj signatur",
    signature: "Signatur",
    hideEarlier: "Dölj tidigare meddelanden",
    showEarlier: (n) => `Visa ${plural(n, "tidigare meddelande", "tidigare meddelanden")}`,
    nothingWritten: "Inget skrevs i den här konversationen.",
  },

  body: {
    translatingTo: (language) => `Översätter till ${language.toLowerCase()}…`,
    translatedTo: (language) => `Översatt till ${language.toLowerCase()}`,
    translating: "Översätter…",
    hideTranslation: "Dölj översättning",
    translateTo: (language) => `Översätt till ${language.toLowerCase()}`,
    loading: "Laddar…",
    readingView: "Läsvy",
    showOriginal: "Visa original",
    imagesBlocked: "Bilder är blockerade. Att ladda dem berättar för avsändaren att du öppnat mejlet.",
    alwaysShowFromSender: "Visa alltid från den här avsändaren",
    showImages: "Visa bilder",
    messageContent: "Meddelandets innehåll",
    summarising: "Sammanfattar…",
    summaryStale: "Nya meddelanden sedan dess. Sammanfatta igen",
    summaryOutOfDate: "Sammanfattning, inaktuell",
    summaryCollapse: "Fäll ihop",
    summaryExpand: "Visa sammanfattningen",
    summarisedAt: (when) => `Gjord ${when}`,
    sinceThen: (n) => `${n} ${n === 1 ? "meddelande" : "meddelanden"} sedan dess`,
    summary: "Sammanfattning",
  },

  preview: {
    needsApp: "Förhandsvisning kräver skrivbordsappen; i en webbläsare finns inget att hämta från.",
    fetching: "Hämtar…",
    rendering: "Ritar upp…",
    pdfFailed: "Den här PDF-filen kunde inte visas.",
    page: (n) => `Sida ${n}`,
    rowsCols: (rows, cols) => `${rows} rader · ${cols} kolumner`,
    firstRows: (shown, total) => `Visar de första ${shown} av ${total} raderna.`,
    firstPages: (shown, total) => `Visar de första ${shown} av ${total} sidorna.`,
  },

  writing: {
    reply: "Svar",
    re: (subject) => `Sv: ${subject}`,
    placeholder: "Skriv ditt svar…",
    fixed: "Rättade stavning och grammatik",
    fixing: "Rättar stavning och grammatik…",
    improved: "Förbättrat",
    improving: "Förbättrar…",
    translated: "Översatt",
    translating: "Översätter…",
    useThis: "Använd det här",
    discard: "Kasta",
    fix: "Rätta stavning & grammatik",
    improve: "Förbättra",
    translateTo: "Översätt till",
    translationLanguage: "Översättningsspråk",
    turnOn: "Slå på skrivassistenten i Inställningar för att rätta, förbättra eller översätta det här.",
    notBuilt: "Att skicka är inte byggt än. Utkast sparas på den här datorn.",
  },

  assistant: {
    downloading: (name, percent) => `Laddar ner ${name} · ${percent} %`,
    off: "Assistent av",
    noModel: "Assistent på · ingen modell vald",
    paused: (name) => `Nedladdningen av ${name} pausad`,
    notDownloaded: (name) => `Assistent på · ${name} inte nedladdad`,
    failed: (name) => `${name} · nedladdningen misslyckades`,
    ready: (name) => `Assistent redo · ${name}`,
    plain: "Assistent",
    openSettings: "Öppna inställningar",
    aiOn: "AI är på",
    aiOff: "AI är av",
    tapToTurnOn: "Körs inte. Klicka för att slå på.",
    noModelChosen: "På, men ingen modell vald",
    downloadingShort: (name, percent) => `Laddar ner ${name} · ${percent} %`,
    pausedShort: (name) => `${name} pausad`,
    failedShort: (name) => `${name} kunde inte laddas ner`,
    notDownloadedShort: (name) => `På, men ${name} är inte nedladdad`,
  },

  settings: {
    title: "Inställningar",
    tabGeneral: "Allmänt",
    mailWindow: "Post att spara",
    mailWindowLede: "Hur långt tillbaka en synk går. Allt nyare än så laddas ner och sparas på den här datorn; äldre post ligger kvar i Gmail tills du utökar det här.",
    fetchBack: "Hämta post från de senaste",
    fetchBackDesc: "Ett större fönster gör den första synken mycket längre.",
    window: { "30": "30 dagarna", "60": "60 dagarna", "180": "6 månaderna", "365": "året", "0": "Allt" } as Record<string, string>,
    appearance: "Utseende",
    appearanceLede: "Hur appen ser ut. Sex paletter, eller följ datorn mellan den ljusa och den mörka.",
    textSize: "Textstorlek",
    textSizeDesc: "Skalar all text i appen.",
    size: { small: "Liten", normal: "Normal", large: "Stor", huge: "Störst" } as Record<string, string>,
    theme: { paper: "Papper", snow: "Snö", sand: "Sand", slate: "Skiffer", ink: "Bläck", midnight: "Midnatt" } as Record<string, string>,
    tabAi: "AI",
    sub: "Allt här stannar på den här datorn.",
    language: "Språk",
    languageLede: "Orden i själva appen. Mejl visas som de skrevs.",
    appLanguage: "Appens språk",
    system: "Samma som datorn",
    assistant: "Skrivassistent",
    assistantLede:
      "Små språkmodeller som körs inuti Lumen. De översätter, rättar och förbättrar text utan att skicka något någonstans. Varje modell kräver en engångsnedladdning och några gigabyte minne medan den används.",
    useAssistant: "Använd assistenten",
    on: "På. Funktionerna nedan dyker upp där de hör hemma så fort den valda modellen är nedladdad.",
    off: "Av. Inget körs och inget syns i appen.",
    writingModel: "Skrivmodell",
    writingModelLede:
      "Sköter rättning, förbättring och sammanfattning, samt översättning om ingen specialist väljs nedan. Välj en; ladda ner den; de andra kan ligga kvar på disken eller tas bort.",
    translationModel: "Översättningsmodell",
    translationModelLede:
      "En modell enbart för översättning, om du vill ha bättre översättningar än skrivmodellen ger. När den är nedladdad och vald använder Översätt den; allt annat använder fortfarande skrivmodellen.",
    translateWith: "Översätt med",
    appleTranslation: "Datorns inbyggda översättning",
    translationLedeMac:
      "Den här datorn översätter själv, lokalt, utan att något behöver laddas ner. Den är bättre på nordiska språk än en modell i den här storleken och är förvald här. En översättningsmodell är alternativet om du hellre slipper den; allt annat körs fortfarande på skrivmodellen.",
    theWritingModel: "Skrivmodellen",
    notDownloaded: "inte nedladdad",
    translateInto: "Översätt till",
    translateIntoDesc: "Språket som alla Översätt-knappar använder.",
    features: "Funktioner",
    featuresLede: "Var och en är en egen brytare. Stäng av det du hellre inte vill att modellen rör.",
    feature: {
      translate: { name: "Översätt", desc: "En Översätt-knapp på varje meddelande och i svarsrutan." },
      proofread: {
        name: "Rätta stavning och grammatik",
        desc: "Rättar ett utkast utan att ändra ordval, ton eller språk.",
      },
      improve: {
        name: "Förbättra text",
        desc: "Skriver om ett utkast så det blir tydligare och bättre strukturerat. Samma innebörd, samma språk.",
      },
      summarize: {
        name: "Sammanfatta trådar",
        desc: "Några meningar om vad en lång konversation handlar om och vad som återstår.",
      },
    },
    model: {
      inUse: "används",
      missing: "Inte nedladdad.",
      downloading: (done, total) => `Laddar ner: ${done} av ${total}`,
      perSecond: (speed) => `${speed}/s`,
      left: (time) => `ungefär ${time} kvar`,
      paused: (done, total) => `Pausad vid ${done} av ${total}. Återuppta fortsätter härifrån.`,
      ready: "Nedladdad.",
      loaded: "Nedladdad och laddad i minnet.",
      error: "Något gick fel.",
      useThis: "Använd den här modellen",
      download: (size) => `Ladda ner ${size}`,
      resume: "Återuppta",
      cancelDelete: "Avbryt och ta bort den ofullständiga filen",
      pause: "Pausa",
      cancel: "Avbryt",
      remove: "Ta bort från disken",
      seconds: (n) => `${n} s`,
      minutes: (n) => `${n} min`,
      hours: (n) => `${n} h`,
      blurbs: {
        "qwen3-1.7b":
          "Liten. Kör på vilken laptop som helst, ungefär 1,5 GB minne. Duger till att rätta och förbättra text; översättning mellan närbesläktade språk blir grov.",
        "qwen3-4b":
          "Bättre. Märkbart mer träffsäker på allt, ungefär 3 GB minne. Långsam på en laptop utan GPU.",
        "translategemma-4b":
          "Enbart översättning. Googles översättningstränade Gemma, 55 språk. Används för Översätt när den är nedladdad; skrivmodellen gör resten.",
      },
    },
  },
};

const nb: Strings = {
  languages: {
    English: "Engelsk",
    Swedish: "Svensk",
    Norwegian: "Norsk",
    Danish: "Dansk",
    German: "Tysk",
    French: "Fransk",
    Spanish: "Spansk",
  },

  common: {
    you: "Du",
    youLower: "deg",
    unknown: "Ukjent",
    noSubject: "(uten emne)",
    close: "Lukk",
    messages: (n) => plural(n, "melding", "meldinger"),
    files: (n) => plural(n, "fil", "filer"),
    justNow: "nå nettopp",
    hours: (n) => plural(n, "time", "timer"),
    days: (n) => plural(n, "dag", "dager"),
    weeks: (n) => plural(n, "uke", "uker"),
    months: (n) => plural(n, "måned", "måneder"),
    ago: (span) => `for ${span} siden`,
    onDevice: "På denne maskinen. Ingenting ble sendt noe sted.",
  },

  app: {
    folders: { inbox: "Innboks", sent: "Sendt", drafts: "Utkast", archive: "Arkiv", trash: "Papirkurv" },
    opening: "Åpner postkassen din…",
    fetching: "Henter e-post…",
    approve: "Godkjenn Lumen i nettleservinduet som nettopp åpnet seg.",
    connected: "Tilkoblet. Henter e-posten din, det tar et øyeblikk…",
    sections: "Seksjoner",
    brandTitle: "Arbeidsnavn, ikke endelig",
    view: "Visning",
    mail: "E-post",
    people: "Personer",
    files: "Filer",
    settings: "Innstillinger",
    checking: "Sjekker…",
    syncNow: "Synk nå",
    signInAgain: "Logg inn på Google igjen",
    checkedAt: (time) => `Sjekket ${time}`,
    resizeSidebar: "Endre bredden på sidepanelet",
    resizeList: "Endre bredden på listen",
    resizeMessageList: "Endre bredden på meldingslisten",
    message: "Melding",
    selectMessage: "Velg en melding.",
    selectSomeone: "Velg noen.",
    syncPartial: (stored, fetched) => `Hentet ${stored} av ${fetched} nye meldinger før det stoppet.`,
    upToDate: "Oppdatert, ingenting nytt.",
    newMessages: (n) => `${plural(n, "ny melding", "nye meldinger")}.`,
  },

  connect: {
    title: "E-posten din, på din maskin",
    lede:
      "Lumen lagrer en kopi av postkassen din lokalt, så den er rask, søkbar og virker uten nett. Det finnes ingen Lumen-server, og ingenting sendes noe annet sted.",
    waiting: "Venter på Google…",
    button: "Koble til Google-konto",
    fact1: "Nettleseren din åpner Googles egen innloggingsside. Lumen ser aldri passordet ditt.",
    fact2: "Tilgangen kan trekkes tilbake når som helst på myaccount.google.com/permissions.",
    fact3: "Lumen ber om å få lese, organisere og sende e-post. Den kan ikke slette noe permanent.",
    fine: "Så lenge appen ikke er verifisert av Google, vises en advarselsside. Fortsett forbi den: bare kontoer på testbrukerlisten kommer så langt.",
  },

  list: {
    messagesAria: "Meldinger",
    conversations: (n) => plural(n, "samtale", "samtaler"),
    searchPlaceholder: "Søk personer, adresser og emner",
    matchedOn: "Også med her:",
    openPerson: (name) => `All post utvekslet med ${name}`,
    searchAria: "Søk i post på person, adresse eller emne",
    searchCount: (n) => `${plural(n, "samtale", "samtaler")}, alle mapper`,
    noMatches: (query) => `Ingenting matcher “${query}”. Dette søket gjelder personer, adresser og emner, ikke det som står i posten.`,
    reader: "Lesevisning",
    nothingIn: (folder) => `Ingenting i ${folder.toLowerCase()}.`,
    people: "Personer",
    machines: "Maskiner",
    noMessages: "Ingen meldinger",
    mailFrom: (name) => `E-post fra ${name}`,
    sentByYou: "Sendt av deg",
    received: "Mottatt",
    toYou: "Til deg",
    toYouAnd: (n) => `Til deg og ${plural(n, "annen", "andre")}`,
    copiedToYou: "Kopi til deg",
    copiedToYouAnd: (n) => `Kopi til deg og ${plural(n, "annen", "andre")}`,
  },

  category: {
    all: "Alle",
    label: (name) => `AI-kategori: ${name}`,
    byModel: "Avgjort av modellen",
    byRule: "Avgjort av en regel, ikke av modellen",
    byYou: "Du la den her",
    descriptionNote: "Assistenten leser disse på engelsk: sortering ble målt med oversatte beskrivelser og ble merkbart dårligere. Skriv om én, så er det dine ord den leser.",
    description: {
      reply: "en person ber meg om noe, eller venter et svar fra meg",
      fyi: "en person har skrevet til meg, men det bes ikke om noe",
      meeting: "en møteinnkalling, eller å avtale et tidspunkt",
      invoice: "en faktura, en kvittering, en betaling eller en ordrebekreftelse",
      automated: "et automatisk varsel fra et system eller en tjeneste",
      newsletter: "markedsføring, kampanjer, produktnyheter sendt til mange",
    } as Record<string, string | undefined>,
    pick: "Kategori",
    unsorted: "Usortert",
    manage: "Kategorier",
    manageLede: "Det posten sorteres i. Gi dem nye navn, legg til egne, eller la assistenten slippe én. Beskrivelsen er det assistenten sorterer etter, så en vag beskrivelse sorterer dårlig.",
    newName: "Navn",
    newDescription: "Beskriv den for assistenten",
    add: "Legg til kategori",
    save: "Lagre",
    remove: "Fjern",
    builtin: "innebygd",
    autoSort: "Assistenten kan sortere hit",
    manualOnly: "Bare du legger post her",
    tooMany: (n) => `Assistenten bruker de ${n} første. Flere enn det begynner den å blande dem.`,
    resort: "Sorter posten på nytt",
    resortLede: "Kaster det reglene og assistenten kom fram til, og sorterer på nytt. Det du har satt for hånd beholdes.",
    removeWarning: "Post i den blir usortert.",
    noneOfKind: "Ingenting i den kategorien.",
    sorting: (done, total) => `Sorterer ${done} av ${total}… stopp`,
    sortAll: (n) => `Sorter ${n} meldinger`,
    needsAi: (n) => `${n} usorterte. Sortering krever at AI er slått på.`,
    sortMore: (n) => `Sorter ${n} til`,
    name: {
      reply: "Krever svar",
      fyi: "Til orientering",
      meeting: "Møter",
      invoice: "Fakturaer",
      automated: "Varsler",
      newsletter: "Nyhetsbrev",
    },
  },

  drafts: {
    inLumen: "Utkast i Lumen",
    inGmail: "utkast i Gmail",
    onlyHere: "Bare på denne maskinen, i Lumen",
    savedHere: "Utkastet lagres i Lumen på denne maskinen, ikke i Gmail.",
    discard: "Slett utkastet",
  },

  message: {
    from: "Fra",
    to: "Til",
    cc: "Kopi",
    attachments: (n) => plural(n, "vedlegg", "vedlegg"),
    andMore: (n) => `og ${n} til`,
    copiedTo: (n) => `Kopi til ${plural(n, "person", "personer")}`,
  },

  things: {
    title: "Filer",
    sub: "Alt som noen gang har kommet inn, uten å lete etter e-posten det lå i.",
    filters: { all: "Alt", pdf: "PDF", sheet: "Regneark", image: "Bilder", doc: "Dokumenter", archive: "Arkiver" },
    searchPlaceholder: "Søk i filnavn og avsendere",
    searchAria: "Søk etter filer på navn eller avsender",
    clear: "Tøm",
    clearSearch: "Tøm søket",
    matching: (n, query) => `${plural(n, "fil", "filer")} matcher “${query}”`,
    nothingMatches: (query) => `Ingenting matcher “${query}”.`,
    noneOfKind: "Ingen filer av den typen.",
    thisWeek: "Denne uken",
    earlier: "Tidligere",
  },

  thread: {
    people: (n) => `${n} personer`,
    hideSummary: "Skjul sammendrag",
    summarise: "Oppsummer",
    closeReply: "Lukk svaret",
    reply: "Svar",
    threadView: "Trådvisning",
    reading: "Lesing",
    timeline: "Tidslinje",
    daysEarlier: (n) => `${n} dager tidligere`,
    weeksEarlier: (n) => `${n} uker tidligere`,
    monthsEarlier: (n) => `${plural(n, "måned", "måneder")} tidligere`,
    hideSignature: "Skjul signatur",
    signature: "Signatur",
    hideEarlier: "Skjul tidligere meldinger",
    showEarlier: (n) => `Vis ${plural(n, "tidligere melding", "tidligere meldinger")}`,
    nothingWritten: "Ingenting ble skrevet i denne samtalen.",
  },

  body: {
    translatingTo: (language) => `Oversetter til ${language.toLowerCase()}…`,
    translatedTo: (language) => `Oversatt til ${language.toLowerCase()}`,
    translating: "Oversetter…",
    hideTranslation: "Skjul oversettelse",
    translateTo: (language) => `Oversett til ${language.toLowerCase()}`,
    loading: "Laster…",
    readingView: "Lesevisning",
    showOriginal: "Vis original",
    imagesBlocked: "Bilder er blokkert. Å laste dem forteller avsenderen at du åpnet e-posten.",
    alwaysShowFromSender: "Vis alltid fra denne avsenderen",
    showImages: "Vis bilder",
    messageContent: "Meldingsinnhold",
    summarising: "Oppsummerer…",
    summaryStale: "Nye meldinger siden. Oppsummer på nytt",
    summaryOutOfDate: "Sammendrag, utdatert",
    summaryCollapse: "Fold sammen",
    summaryExpand: "Vis sammendraget",
    summarisedAt: (when) => `Laget ${when}`,
    sinceThen: (n) => `${n} ${n === 1 ? "melding" : "meldinger"} siden`,
    summary: "Sammendrag",
  },

  preview: {
    needsApp: "Forhåndsvisning krever skrivebordsappen; i en nettleser er det ingenting å hente fra.",
    fetching: "Henter…",
    rendering: "Tegner opp…",
    pdfFailed: "Denne PDF-en kunne ikke vises.",
    page: (n) => `Side ${n}`,
    rowsCols: (rows, cols) => `${rows} rader · ${cols} kolonner`,
    firstRows: (shown, total) => `Viser de første ${shown} av ${total} radene.`,
    firstPages: (shown, total) => `Viser de første ${shown} av ${total} sidene.`,
  },

  writing: {
    reply: "Svar",
    re: (subject) => `Sv: ${subject}`,
    placeholder: "Skriv svaret ditt…",
    fixed: "Rettet stavemåte og grammatikk",
    fixing: "Retter stavemåte og grammatikk…",
    improved: "Forbedret",
    improving: "Forbedrer…",
    translated: "Oversatt",
    translating: "Oversetter…",
    useThis: "Bruk dette",
    discard: "Forkast",
    fix: "Rett stavemåte og grammatikk",
    improve: "Forbedre",
    translateTo: "Oversett til",
    translationLanguage: "Oversettelsesspråk",
    turnOn: "Slå på skriveassistenten i Innstillinger for å rette, forbedre eller oversette dette.",
    notBuilt: "Sending er ikke bygget ennå. Utkast lagres på denne maskinen.",
  },

  assistant: {
    downloading: (name, percent) => `Laster ned ${name} · ${percent} %`,
    off: "Assistent av",
    noModel: "Assistent på · ingen modell valgt",
    paused: (name) => `Nedlastingen av ${name} er satt på pause`,
    notDownloaded: (name) => `Assistent på · ${name} ikke lastet ned`,
    failed: (name) => `${name} · nedlastingen mislyktes`,
    ready: (name) => `Assistent klar · ${name}`,
    plain: "Assistent",
    openSettings: "Åpne innstillinger",
    aiOn: "AI er på",
    aiOff: "AI er av",
    tapToTurnOn: "Kjører ikke. Klikk for å slå på.",
    noModelChosen: "På, men ingen modell valgt",
    downloadingShort: (name, percent) => `Laster ned ${name} · ${percent} %`,
    pausedShort: (name) => `${name} satt på pause`,
    failedShort: (name) => `${name} kunne ikke lastes ned`,
    notDownloadedShort: (name) => `På, men ${name} er ikke lastet ned`,
  },

  settings: {
    title: "Innstillinger",
    tabGeneral: "Generelt",
    mailWindow: "Post å beholde",
    mailWindowLede: "Hvor langt tilbake en synk går. Alt nyere enn det lastes ned og lagres på denne maskinen; eldre post blir liggende i Gmail til du utvider dette.",
    fetchBack: "Hent post fra de siste",
    fetchBackDesc: "Et større vindu gjør den første synken mye lengre.",
    window: { "30": "30 dagene", "60": "60 dagene", "180": "6 månedene", "365": "året", "0": "Alt" } as Record<string, string>,
    appearance: "Utseende",
    appearanceLede: "Hvordan appen ser ut. Seks paletter, eller følg maskinen mellom den lyse og den mørke.",
    textSize: "Tekststørrelse",
    textSizeDesc: "Skalerer all tekst i appen.",
    size: { small: "Liten", normal: "Normal", large: "Stor", huge: "Størst" } as Record<string, string>,
    theme: { paper: "Papir", snow: "Snø", sand: "Sand", slate: "Skifer", ink: "Blekk", midnight: "Midnatt" } as Record<string, string>,
    tabAi: "AI",
    sub: "Alt her blir på denne maskinen.",
    language: "Språk",
    languageLede: "Ordene i selve appen. E-post vises slik den ble skrevet.",
    appLanguage: "Appens språk",
    system: "Samme som maskinen",
    assistant: "Skriveassistent",
    assistantLede:
      "Små språkmodeller som kjører inne i Lumen. De oversetter, retter og forbedrer tekst uten å sende noe noe sted. Hver modell krever en engangsnedlasting og noen gigabyte minne mens den er i bruk.",
    useAssistant: "Bruk assistenten",
    on: "På. Funksjonene under dukker opp der de hører hjemme så snart den valgte modellen er lastet ned.",
    off: "Av. Ingenting kjører og ingenting vises i appen.",
    writingModel: "Skrivemodell",
    writingModelLede:
      "Gjør retting, forbedring og oppsummering, og oversettelse om ingen spesialist velges under. Velg én; last den ned; de andre kan bli liggende på disken eller fjernes.",
    translationModel: "Oversettelsesmodell",
    translationModelLede:
      "En modell bare for oversettelse, om du vil ha bedre oversettelser enn skrivemodellen gir. Når den er lastet ned og valgt, bruker Oversett den; alt annet bruker fortsatt skrivemodellen.",
    translateWith: "Oversett med",
    appleTranslation: "Macens innebygde oversettelse",
    translationLedeMac:
      "Denne maskinen oversetter selv, lokalt, uten at noe må lastes ned. Den er bedre på nordiske språk enn en modell i denne størrelsen, og er forhåndsvalgt her. En oversettelsesmodell er alternativet om du heller vil slippe den; alt annet kjøres fortsatt på skrivemodellen.",
    theWritingModel: "Skrivemodellen",
    notDownloaded: "ikke lastet ned",
    translateInto: "Oversett til",
    translateIntoDesc: "Språket alle Oversett-knapper bruker.",
    features: "Funksjoner",
    featuresLede: "Hver av dem er en egen bryter. Slå av det du helst ikke vil at modellen skal røre.",
    feature: {
      translate: { name: "Oversett", desc: "En Oversett-knapp på hver melding og i svarfeltet." },
      proofread: {
        name: "Rett stavemåte og grammatikk",
        desc: "Retter et utkast uten å endre ordvalg, tone eller språk.",
      },
      improve: {
        name: "Forbedre tekst",
        desc: "Skriver om et utkast så det blir klarere og bedre strukturert. Samme mening, samme språk.",
      },
      summarize: {
        name: "Oppsummer tråder",
        desc: "Noen setninger om hva en lang samtale handler om og hva som gjenstår.",
      },
    },
    model: {
      inUse: "i bruk",
      missing: "Ikke lastet ned.",
      downloading: (done, total) => `Laster ned: ${done} av ${total}`,
      perSecond: (speed) => `${speed}/s`,
      left: (time) => `omtrent ${time} igjen`,
      paused: (done, total) => `Pauset ved ${done} av ${total}. Fortsett tar det opp herfra.`,
      ready: "Lastet ned.",
      loaded: "Lastet ned og lastet inn i minnet.",
      error: "Noe gikk galt.",
      useThis: "Bruk denne modellen",
      download: (size) => `Last ned ${size}`,
      resume: "Fortsett",
      cancelDelete: "Avbryt og slett den ufullstendige filen",
      pause: "Pause",
      cancel: "Avbryt",
      remove: "Fjern fra disken",
      seconds: (n) => `${n} s`,
      minutes: (n) => `${n} min`,
      hours: (n) => `${n} t`,
      blurbs: {
        "qwen3-1.7b":
          "Liten. Kjører på hvilken som helst laptop, omtrent 1,5 GB minne. Grei til å rette og forbedre tekst; oversettelse mellom nært beslektede språk blir grov.",
        "qwen3-4b":
          "Bedre. Merkbart mer treffsikker på alt, omtrent 3 GB minne. Treg på en laptop uten GPU.",
        "translategemma-4b":
          "Bare oversettelse. Googles oversettelsestrente Gemma, 55 språk. Brukes for Oversett når den er lastet ned; skrivemodellen gjør resten.",
      },
    },
  },
};

const DICTS: Record<Locale, Strings> = { en, sv, nb };

// Read by the date helpers in format.ts, which are plain functions rather than hooks.
// Set by the provider; every component that shows a date also reads strings through the
// context, so a change of language re-renders it.
let current: Locale = detectLocale();

export function currentLocale(): Locale {
  return current;
}

export function localeTag(): string {
  return TAGS[current];
}

export function strings(): Strings {
  return DICTS[current];
}

interface LocaleContextValue {
  locale: Locale;
  choice: LocaleChoice;
  setChoice: (choice: LocaleChoice) => void;
  t: Strings;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readChoice(): LocaleChoice {
  try {
    const raw = localStorage.getItem(CHOICE_KEY);
    return raw === "en" || raw === "sv" || raw === "nb" ? raw : "system";
  } catch {
    return "system";
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<LocaleChoice>(readChoice);
  const locale = choice === "system" ? detectLocale() : choice;
  current = locale;

  const setChoice = useCallback((next: LocaleChoice) => {
    setChoiceState(next);
    try {
      localStorage.setItem(CHOICE_KEY, next);
    } catch {
      // A preference is not worth failing over.
    }
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, choice, setChoice, t: DICTS[locale] }),
    [locale, choice, setChoice],
  );

  // Keyed on the locale so every piece of state that cached a string starts over. Switching
  // language is rare; losing a selected thread over it is a fair trade for never showing
  // two languages at once.
  return (
    <LocaleContext.Provider value={value}>
      <div key={locale} style={{ display: "contents" }}>
        {children}
      </div>
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale outside LocaleProvider");
  return value;
}

/** The strings for the current language. */
export function useT(): Strings {
  return useLocale().t;
}
