// Dev-only gallery of every interactive-answer component in its states (spec: generative-ui.md §8, phase 1):
// open the app with ?preview=genui. Programs are real OpenUI Lang run through the real renderer; actions are
// sandboxed (they say what they would do). The generated prompt and its size are at the bottom.
import { useMemo, useState } from 'react'
import { decks, useLibrary } from '../data/library'
import type { Deck } from '../data/types'
import Block from './Block'
import { blockPrompt } from './library'
import s from './genui.module.css'

function samples(d: Deck | undefined, d2: Deck | undefined): { name: string; program: string }[] {
  const deck = d?.id ?? 'd-missing', slide = d?.slides[1]?.id ?? d?.slides[0]?.id ?? 's-missing', slide2 = d2?.slides[0]?.id ?? 's-missing'
  return [
    { name: 'Scenario: slider, stats, sources, buttons', program: `root = Card([seats, Columns([perSeat, usage]), note, Sources([r1, r2])], "Seats vs. usage", [ask, put, draft])
$seats = 40
seats = Slider("Seats", $seats, 5, 200, 5)
perSeat = Stat("Per-seat plan", $seats * 12, null, "a month", "down", "money:GBP")
usage = Stat("Usage plan", 300 + $seats * 7.5, null, $seats * 12 > 300 + $seats * 7.5 ? "Cheaper at this size" : "Dearer at this size", "down", "money:GBP")
note = Callout("Usage pricing wins above 67 seats.", "info")
r1 = SlideRef("${deck}", "${slide}")
r2 = SlideRef("${d2?.id ?? deck}", "${slide2}")
ask = Button("Which plan suits a 60-seat customer?", @ToAssistant("Which plan suits a 60-seat customer?"))
put = Button("Put on a slide in ${d?.name ?? 'Q3 review'}", @PutOnSlide("${deck}", {title: "Seats vs. usage", table: {columns: ["Plan", "Monthly"], rows: [["Per seat", 480], ["Usage", 600]]}}))
draft = Button("Draft: restyle this as a chart", @Draft("Turn the seats vs. usage comparison into a chart slide in ${d?.name ?? 'Q3 review'}"))` },
    { name: 'Comparison: tabs, sortable table, chart', program: `root = Card([Tabs([Tab("Table", [tbl]), Tab("Chart", [ch])])], "Quarterly results")
tbl = Table([{label: "Quarter"}, {label: "Revenue", type: "money", unit: "GBP"}, {label: "Growth", type: "percent"}], [["Q1", 4300000, 0.04], ["Q2", 4510000, 0.049], ["Q3", 5120000, 0.135], ["Q4", 4980000, -0.027]], true)
ch = Chart("column", ["Q1", "Q2", "Q3", "Q4"], [{name: "Revenue (£m)", values: [4.3, 4.51, 5.12, 4.98]}], "Revenue by quarter")` },
    { name: 'A choice to make, and fields', program: `root = Card([pick, size, owner, notes, agree], "Next step for the pitch", [go, reset])
$pick = null
$size = "m"
$owner = ""
$notes = ""
$agree = false
pick = Choice("Which direction?", $pick, [{id: "a", label: "Lead with the customer story", detail: "Warmer; needs the quote approved"}, {id: "b", label: "Lead with the numbers", detail: "Stronger for the board"}])
size = Segmented("Length", $size, [{id: "s", label: "5 min"}, {id: "m", label: "10 min"}, {id: "l", label: "20 min"}])
owner = Select("Owner", $owner, [{id: "sam", label: "Sam"}, {id: "ali", label: "Ali"}])
notes = TextField("Anything else?", $notes, "Optional", true)
agree = Toggle("Include the appendix", $agree)
go = Button("Go with the customer story", @ToAssistant("Go with the customer story"))
reset = Button("Start over", @Reset($pick, $size, $owner, $notes, $agree))` },
    { name: 'Text, lists, key values, progress, deck refs', program: `root = Card([t, kv, l, pr, Sources([dr])], "Launch checklist")
t = Text("Three of five sections are **done**. The pricing slide still needs the new numbers.")
kv = KeyValues([["Owner", "Sam"], ["Due", "12 Dec"], ["Slides", 14]])
l = List([["Story", "Done"], ["Pricing", "Needs numbers"], ["Appendix"]])
pr = Progress(3, 5, "Sections ready")
dr = DeckRef("${deck}")` },
    { name: 'Refused: button label doesn’t match its message', program: `root = Card([Text("This button would send something other than what it says.")], "A bad button", [b])
b = Button("Looks good", @ToAssistant("Rename every deck to TEST"))` },
    { name: 'Refused: two effects on one button', program: `root = Card([Text("One effect per click.")], "Two at once", [b])
b = Button("Copy and open", Action([@Copy("x"), @OpenUrl("https://example.com")]))` },
    { name: 'Errors: ragged table, bad chart, missing slide', program: `root = Card([t, c, Sources([SlideRef("${deck}", "s-not-there"), SlideRef("d-nope", "s-1")])], "Broken data")
t = Table([{label: "A"}, {label: "B"}], [["x"], ["y", 2]])
c = Chart("pie", ["A", "B"], [{name: "One", values: [1, 2]}, {name: "Two", values: [3, 4]}])` },
    { name: 'Unfinished (stopped mid-stream)', program: `root = Card([a, b], "Half a block")
a = Stat("Revenue", 4300000, 0.04, null, "up", "compact")
b = Text("This block was cut off befo` },
  ]
}

export default function GenuiGallery() {
  const lib = useLibrary()
  const ds = decks(lib).filter((d) => d.trashedAt === null && !d.remote && d.parentId)
  const d = ds[0], d2 = ds[1]
  const list = useMemo(() => samples(d, d2), [d?.id, d2?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [showPrompt, setShowPrompt] = useState(false)
  const prompt = useMemo(() => blockPrompt(), [])
  ;(window as unknown as { __genuiPrompt?: string }).__genuiPrompt = prompt
  return (
    <main className={s.gallery}>
      <h1>Interactive answers: components</h1>
      <p>Real programs through the real renderer. Actions in the gallery run against project “{d ? (lib.entries[d.parentId!]?.name ?? '') : 'none'}”.</p>
      {list.map((x, i) => (
        <section key={i} className={s.gallerySection}>
          <h2>{x.name}</h2>
          <Block id={`gallery.${i}`} program={x.program} streaming={false} unfinished={x.name.startsWith('Unfinished')} projectId={d?.parentId ?? ''} chatId={`${d?.parentId}~gallery`} turnAt={0} />
        </section>
      ))}
      <section className={s.gallerySection}>
        <h2>Prompt the model gets ({prompt.length.toLocaleString()} characters, about {Math.round(prompt.length / 3.6).toLocaleString()} tokens)</h2>
        <button type="button" className={s.linkButton} onClick={() => setShowPrompt(!showPrompt)}>{showPrompt ? 'Hide' : 'Show'}</button>
        {showPrompt && <pre className={s.code} style={{ maxHeight: 'none' }}>{prompt}</pre>}
      </section>
    </main>
  )
}
