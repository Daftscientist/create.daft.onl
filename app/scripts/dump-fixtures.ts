// Dumps the sample decks as JSON for scripts/gen-sample-slides.py.
import { writeFileSync } from 'node:fs'
import { sampleSpecs } from '../src/data/fixtures'
const decks = sampleSpecs()
writeFileSync(process.argv[2], JSON.stringify(decks))
console.log(decks.length, 'decks')
