// Fixture data. No provider is connected yet, so the interface is designed against this.
//
// Deliberately includes the awkward cases rather than a tidy demo inbox: a thread that
// has been running for weeks, a message with no subject, one mail carrying six files,
// mixed Norwegian, Swedish and English, and enough quiet mail that the "quiet" pile is
// realistically large. Designing against pretty data is how you ship a UI that breaks on
// contact with a real mailbox.

import type { Message, Obligation, Person, Thing } from "./types";

const now = new Date();

function ago(days: number, hours = 0): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hours);
  return d.toISOString();
}

export const people: Person[] = [
  { id: "asgeir", name: "Asgeir Heart", email: "asgeir@bambusa.no", role: "CIO & Partner, Bambusa AS" },
  { id: "alexander", name: "Alexander Ek", email: "alexander@bambusa.se", role: "Bambusa" },
  { id: "alexandra", name: "Alexandra Sundberg", email: "alexandra@bambusa.se", role: "Bambusa" },
  { id: "havard", name: "Håvard Nilsen", email: "havard@bambusa.no", role: "Bambusa AS" },
  { id: "klaviyo-support", name: "Klaviyo Support", email: "support@klaviyo.com", role: "Ticket #884213" },
  { id: "klaviyo", name: "Klaviyo", email: "no-reply@klaviyo.com", isBroadcast: true },
  { id: "shopify", name: "Shopify", email: "no-reply@shopify.com", isBroadcast: true },
  { id: "fortnox", name: "Fortnox", email: "no-reply@fortnox.se", isBroadcast: true },
  { id: "linear", name: "Linear", email: "no-reply@linear.app", isBroadcast: true },
];

export const things: Thing[] = [
  { id: "t1", filename: "flow-b-export-2026-09-04.csv", kind: "sheet", sizeBytes: 184_320, personId: "asgeir", messageId: "m2", receivedAt: ago(6) },
  { id: "t2", filename: "Skjermbilde dobbelt utsending.png", kind: "image", sizeBytes: 1_240_000, personId: "asgeir", messageId: "m2", receivedAt: ago(6) },
  { id: "t3", filename: "EAN-lista boxershorts Q4.xlsx", kind: "sheet", sizeBytes: 42_100, personId: "alexander", messageId: "m8", receivedAt: ago(1) },
  { id: "t4", filename: "Deltagarlista Pipline klubb.pdf", kind: "pdf", sizeBytes: 96_400, personId: "alexandra", messageId: "m11", receivedAt: ago(0, 5) },
  { id: "t5", filename: "Faktura 2026-4471.pdf", kind: "pdf", sizeBytes: 78_200, personId: "fortnox", messageId: "m20", receivedAt: ago(2) },
  { id: "t6", filename: "brief-host-kampanj.docx", kind: "doc", sizeBytes: 310_000, personId: "havard", messageId: "m14", receivedAt: ago(3) },
  { id: "t7", filename: "produktbilder-boxers.zip", kind: "archive", sizeBytes: 24_800_000, personId: "havard", messageId: "m14", receivedAt: ago(3) },
  { id: "t8", filename: "sokk-01.jpg", kind: "image", sizeBytes: 2_100_000, personId: "havard", messageId: "m14", receivedAt: ago(3) },
  { id: "t9", filename: "sokk-02.jpg", kind: "image", sizeBytes: 2_240_000, personId: "havard", messageId: "m14", receivedAt: ago(3) },
  { id: "t10", filename: "sokk-03.jpg", kind: "image", sizeBytes: 1_980_000, personId: "havard", messageId: "m14", receivedAt: ago(3) },
  { id: "t11", filename: "storleksguide.pdf", kind: "pdf", sizeBytes: 512_000, personId: "havard", messageId: "m14", receivedAt: ago(3) },
  { id: "t12", filename: "klaviyo-weekly-2026-w36.pdf", kind: "pdf", sizeBytes: 640_000, personId: "klaviyo", messageId: "m18", receivedAt: ago(4) },
  { id: "t13", filename: "payout-2026-09-07.pdf", kind: "pdf", sizeBytes: 51_000, personId: "shopify", messageId: "m19", receivedAt: ago(3) },
  { id: "t14", filename: "segment-audit.numbers", kind: "sheet", sizeBytes: 220_000, personId: "asgeir", messageId: "m5", receivedAt: ago(12) },
];

export const messages: Message[] = [
  // Asgeir: a thread that has been running for weeks. The oldest ask is still unanswered,
  // which is exactly the failure the home screen exists to surface.
  { id: "m1", personId: "asgeir", fromMe: false, subject: "Klaviyo flow B", body: "Hei Hannes! Har du tid til å se på flow B denne uka? Noen kunder rapporterer at de får e-posten to ganger.", sentAt: ago(21), attachmentIds: [] },
  { id: "m2", personId: "asgeir", fromMe: false, subject: "Klaviyo flow B", body: "Her er eksporten og et skjermbilde fra en av kundene. Ser ut som trigger-betingelsen fyrer to ganger når noen legger til i handlekurven og så fjerner varen igjen.", sentAt: ago(6), attachmentIds: ["t1", "t2"], audience: { others: ["Alexandra Sundberg"] } },
  { id: "m3", personId: "asgeir", fromMe: true, subject: "Klaviyo flow B", body: "Ska kolla på det imorgon. Tror det är trigger-villkoret som du säger.", sentAt: ago(5, 3), attachmentIds: [] },
  { unread: true, id: "m4", personId: "asgeir", fromMe: false, subject: "Klaviyo flow B", body: "Noe nytt her? Kunden spør igjen.", sentAt: ago(2), attachmentIds: [] , category: "reply", categorySource: "model"},
  { id: "m5", personId: "asgeir", fromMe: false, subject: "Segment-audit", body: "Denne kan vente, men når du har tid: kan du se over segmentene? Mistenker vi har mange som overlapper.", sentAt: ago(12), attachmentIds: ["t14"] },

  // Alexander routes Håvard's requests. Two people, one obligation.
  { unread: true, id: "m8", personId: "alexander", fromMe: false, subject: "Nya EAN-koder", body: "Hej! Håvard behöver EAN-koder för tre nya boxershorts innan fredag. Listan bifogad, kolumn C är tom.", sentAt: ago(1), attachmentIds: ["t3"], audience: { others: ["Håvard Nilsen"], to: [{ name: "Hannes Almar", email: "hannes@bambusa.se" }, { name: "Håvard Nilsen", email: "havard@bambusa.no" }] }, sender: { name: "Alexander Ek", email: "alexander@bambusa.se" } , category: "reply", categorySource: "model"},
  { id: "m9", personId: "alexander", fromMe: true, subject: "Nya EAN-koder", body: "Tar det imorgon.", sentAt: ago(0, 20), attachmentIds: [] },

  // Alexandra: you are the one waiting here.
  { id: "m10", personId: "alexandra", fromMe: true, subject: "Pipline klubb, datum", body: "Kan du bekräfta om vi kör torsdag eller fredag nästa vecka? Behöver boka rummet.", sentAt: ago(3), attachmentIds: [] },
  { unread: true, id: "m11", personId: "alexandra", fromMe: false, subject: undefined, body: "Här är listan så länge, återkommer om datumet.", sentAt: ago(0, 5), attachmentIds: ["t4"] , category: "fyi", categorySource: "model"},

  { id: "m14", personId: "havard", fromMe: false, subject: "Bilder og brief til høstkampanjen", body: "Sender over alt materiellet. Si fra om noe mangler.", sentAt: ago(3), attachmentIds: ["t6", "t7", "t8", "t9", "t10", "t11"], audience: { cc: true, others: ["Alexander Ek", "Asgeir Heart"] } },

  { unread: true, id: "m15", personId: "klaviyo-support", fromMe: false, subject: "Re: [Ticket #884213] API rate limit on profile updates", body: "Hi Hannes, following up on this one. Could you confirm whether you are batching the profile updates? We have not heard back since the 3rd.", sentAt: ago(4), attachmentIds: [] , category: "reply", categorySource: "model"},


  // A long, awkward thread: four people, six weeks, a three-week silence in the middle,
  // quoting in three different client styles, and signatures. This is the case the thread
  // reader exists for, and none of it is representable without a shared threadId.
  { id: "L1", threadId: "T-host", personId: "havard", fromMe: false, subject: "Høstkampanjen: hvem gjør hva?", body: "Hei alle sammen!\n\nVi må få satt opp høstkampanjen. Jeg tar bilder og brief, men trenger hjelp med flowene i Klaviyo og med EAN-kodene.\n\nKan dere si fra hva dere kan ta?\n\nMvh\nHåvard Nilsen\nBambusa AS\n+47 900 12 345", sentAt: ago(42), attachmentIds: [], audience: { others: ["Asgeir Heart", "Alexandra Sundberg"] } },
  { id: "L2", threadId: "T-host", personId: "asgeir", fromMe: false, subject: "Re: Høstkampanjen: hvem gjør hva?", body: "Jeg tar Klaviyo-biten sammen med Hannes.\n\nDen 29. juli 2026 kl. 09:14 skrev Håvard Nilsen <havard@bambusa.no>:\n> Hei alle sammen!\n>\n> Vi må få satt opp høstkampanjen. Jeg tar bilder og brief, men trenger\n> hjelp med flowene i Klaviyo og med EAN-kodene.\n>\n> Mvh\n> Håvard", sentAt: ago(42), attachmentIds: [], audience: { others: ["Håvard Nilsen", "Alexandra Sundberg"] } },
  { id: "L3", threadId: "T-host", personId: "havard", fromMe: true, subject: "Re: Høstkampanjen: hvem gjør hva?", body: "Jag kan ta flowen. Behöver bara veta vilka segment som gäller.\n\nMvh\nHannes", sentAt: ago(41), attachmentIds: [], audience: { others: ["Asgeir Heart", "Alexandra Sundberg"] } },
  { id: "L4", threadId: "T-host", personId: "alexandra", fromMe: false, subject: "Re: Høstkampanjen: hvem gjør hva?", body: "Jag fixar deltagarlistan och bokar rummet för genomgången.\n\nDen 30 juli 2026 kl. 11:02 skrev Hannes <hannes@bambusa.se>:\n> Jag kan ta flowen. Behöver bara veta vilka segment som gäller.\n>\n> Mvh\n> Hannes", sentAt: ago(41), attachmentIds: [], audience: { others: ["Håvard Nilsen", "Asgeir Heart"], to: [{ name: "Hannes Almar", email: "hannes@bambusa.se" }], copies: [{ name: "Håvard Nilsen", email: "havard@bambusa.no" }, { name: "Asgeir Heart", email: "asgeir@bambusa.no" }, { name: "Kristin Bakke", email: "kristin@bambusa.no" }] }, sender: { name: "Alexandra Sundberg", email: "alexandra@bambusa.se" } },
  { id: "L5", threadId: "T-host", personId: "asgeir", fromMe: false, subject: "Re: Høstkampanjen: hvem gjør hva?", body: "Segmentene ligger i arket. Sier fra når jeg har ryddet i dem.\n\nVennlig hilsen\nAsgeir Heart\nCIO & Partner, Bambusa AS", sentAt: ago(40), attachmentIds: ["t14"], audience: { others: ["Håvard Nilsen", "Alexandra Sundberg"] } },
  { id: "L6", threadId: "T-host", personId: "havard", fromMe: false, subject: "Re: Høstkampanjen: hvem gjør hva?", body: "Noe nytt her? Vi begynner å bli sent ute.\n\n-----Original Message-----\nFrom: Asgeir Heart <asgeir@bambusa.no>\nSent: 1 August 2026 14:20\nTo: Håvard Nilsen; Alexandra Sundberg\nSubject: Re: Høstkampanjen: hvem gjør hva?\n\nSegmentene ligger i arket. Sier fra når jeg har ryddet i dem.", sentAt: ago(19), attachmentIds: [], audience: { cc: true, others: ["Asgeir Heart", "Alexandra Sundberg"] } },
  { id: "L7", threadId: "T-host", personId: "havard", fromMe: false, subject: "Re: Høstkampanjen: hvem gjør hva?", body: "Sender over alt materiellet nå. Si fra om noe mangler.\n\nMvh\nHåvard Nilsen\nBambusa AS\n+47 900 12 345", sentAt: ago(3), attachmentIds: ["t6", "t7", "t8", "t9", "t10", "t11"], audience: { cc: true, others: ["Alexander Ek", "Asgeir Heart"] } },
  { unread: true, id: "L8", threadId: "T-host", personId: "alexandra", fromMe: false, subject: "Re: Høstkampanjen: hvem gjør hva?", body: "Rummet är bokat för torsdag. Hannes, hinner du med flowen till dess?\n\nOn 7 Sep 2026 at 08:41, Håvard Nilsen <havard@bambusa.no> wrote:\n> Sender over alt materiellet nå. Si fra om noe mangler.\n>\n> Mvh\n> Håvard Nilsen\n\nDen 1 augusti 2026 kl. 14:20 skrev Asgeir Heart <asgeir@bambusa.no>:\n>> Segmentene ligger i arket.", sentAt: ago(1), attachmentIds: ["t4"], audience: { others: ["Håvard Nilsen", "Asgeir Heart"], to: [{ name: "Hannes Almar", email: "hannes@bambusa.se" }], copies: [{ name: "Håvard Nilsen", email: "havard@bambusa.no" }, { name: "Asgeir Heart", email: "asgeir@bambusa.no" }, { name: "Kristin Bakke", email: "kristin@bambusa.no" }] }, sender: { name: "Alexandra Sundberg", email: "alexandra@bambusa.se" } , category: "reply", categorySource: "model"},

  // Quiet pile: nothing here needs a human.
  { id: "m18", personId: "klaviyo", fromMe: false, subject: "Your weekly performance report", body: "Open rate 41.2%, click rate 3.8%. Revenue attributed to email: 184 220 SEK.", sentAt: ago(4), attachmentIds: ["t12"] , category: "newsletter", categorySource: "rule"},
  { id: "m19", personId: "shopify", fromMe: false, subject: "Payout of 48 120 SEK is on the way", body: "Your payout has been sent to your bank account.", sentAt: ago(3), attachmentIds: ["t13"] , category: "invoice", categorySource: "rule"},
  { id: "m20", personId: "fortnox", fromMe: false, subject: "Faktura 2026-4471 är betald", body: "Tack för din betalning.", sentAt: ago(2), attachmentIds: ["t5"] , category: "invoice", categorySource: "rule"},
  { unread: true, id: "m21", personId: "linear", fromMe: false, subject: "5 issues were updated in Bambusa Hub", body: "BAM-412, BAM-418, BAM-419, BAM-420, BAM-421.", sentAt: ago(1), attachmentIds: [], audience: { cc: true } , category: "automated", categorySource: "rule"},
  { id: "m22", personId: "klaviyo", fromMe: false, subject: "New: conditional splits in flows", body: "Product update.", sentAt: ago(8), attachmentIds: [] , category: "newsletter", categorySource: "rule"},
  { id: "m23", personId: "shopify", fromMe: false, subject: "Payout of 12 440 SEK is on the way", body: "Your payout has been sent to your bank account.", sentAt: ago(10), attachmentIds: [] , category: "invoice", categorySource: "rule"},
];

/**
 * Hand-written for now.
 *
 * In the real app something has to derive these from message text, and that is the single
 * biggest open question in the product: heuristics, a local model, or the user marking
 * them by hand. The interface is built first so that question can be answered against a
 * working screen instead of in the abstract.
 */
export const obligations: Obligation[] = [
  { id: "o1", direction: "owed", personId: "asgeir", summary: "Fix the double send in Klaviyo flow B", since: ago(21), messageId: "m4" },
  { id: "o2", direction: "owed", personId: "alexander", summary: "EAN codes for three new boxershorts, before Friday", since: ago(1), messageId: "m8" },
  { id: "o3", direction: "owed", personId: "klaviyo-support", summary: "Confirm whether profile updates are batched", since: ago(4), messageId: "m15" },
  { id: "o4", direction: "owed", personId: "asgeir", summary: "Look over the overlapping segments", since: ago(12), messageId: "m5" },
  { id: "o5", direction: "awaiting", personId: "alexandra", summary: "Thursday or Friday for Pipline klubb", since: ago(3), messageId: "m10" },
  { id: "o6", direction: "awaiting", personId: "havard", summary: "Whether the sock images are the final crops", since: ago(3), messageId: "m14" },
];
