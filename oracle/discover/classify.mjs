// The category of one input (see README.md): the join of the oracle verdicts with the tree-sitter result.
//   A1 valid, tree not clean, both tools accept (reducible)     A2 valid (test262), tree not clean, a tool rejects
//   B1/B2/B3 invalid, tree clean: both tools syntax / both early / the oracle cannot tell     C no truth, tools disagree
//   T parse timeout     X the input was unreadable or changed since collect (tsparse `bad`): no verdict, never a defect
//   ok otherwise
// rec: oracle.jsonl record (b/o per source type); t: tsparse result ({clean, err, timeout}).
const consensus = (b, o) => (b === o ? b : "disagree");

export function classify(rec, t) {
  const types = Object.keys(rec.b);
  const per = Object.fromEntries(types.map((ty) => [ty, consensus(rec.b[ty].c, rec.o[ty].c)]));
  // The source type that decides: for npm and fixtures the first type both tools accept, else the first with a common
  // class; for test262 the one its metadata fixes.
  const pick = (c) => types.find((ty) => per[ty] === c);
  const type = pick("accept") ?? pick("early") ?? pick("syntax") ?? types[0];
  const cls = per[type];
  const bc = rec.b[type].c;
  const oc = rec.o[type].c;
  let truth = rec.truth;
  if (truth === "unknown") truth = cls === "accept" ? "valid" : cls === "disagree" ? "unknown" : "invalid";
  let cat;
  if (t.bad) cat = "X";
  else if (t.timeout) cat = "T";
  else if (truth === "valid" && !t.clean) cat = bc === "accept" && oc === "accept" ? "A1" : "A2";
  else if (truth === "invalid" && !t.err) cat = cls === "syntax" ? "B1" : cls === "early" ? "B2" : "B3";
  else if (truth === "unknown") cat = "C";
  else cat = "ok";
  return { type, cls, bc, oc, truth, cat };
}
