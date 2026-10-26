# Rashomon Model Explorer

An interactive system that supports exploring sets of interpretable, near-optimal sparse generalized additive models, and helping experts translate domain expertise into model constraints to inspect model behavior, identify implausible relationships, and narrow candidate models.

## App (`app/`)

Requires Node 20.19+ (or 22.12+).

```sh
cd app
npm install
npm run dev       # development server
npm test          # unit tests (vitest)
npm run build     # production build → app/dist/
npm run preview   # serve the built site locally
```

`app/dist/` is the whole website. Publish it to any static host; it works at a domain root or in a subdirectory. The bundled demo (`app/public/data/demo.json`, built from SUPPORT2) ships with the repo, so building and hosting never need Python.

To publish to GitHub Pages (the `gh-pages` branch of this repo):

```sh
cd app
npm run deploy    # builds, then pushes app/dist/ to gh-pages
```

## Data pipeline (`prep/`)

Optional: regenerates `demo.json` or builds a model set from your own CSV. Requires Python 3.10+.

```sh
cd prep
python -m venv .venv
.venv/Scripts/activate          # Windows; on macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python fetch_support2.py        # writes out/support2.csv
python build_modelset.py --csv out/support2.csv --target hospdead \
   --features age,temp,hrt,resp,meanbp,wblc,sod,crea,bili,bun,alb,pafi,scoma,glucose,urine,ph,num.co,dementia,diabetes,ca \
   --out ../app/public/data/demo.json --n-models 150 --n-rows 800 --epsilon 0.05 --seed 0 \
   --impute-json support2_impute.json --recode-json support2_recode.json \
   --name "SUPPORT2 in-hospital death (demo)" --label-names '{"0": "survived", "1": "died in hospital"}'
```

See [prep/README.md](prep/README.md) for details and self-checks.

## Acceptance checks

Automated: `cd app && npm test` (math, geometry, validation, constraints, undo/redo, transitions, export/import) and `cd prep && python check_validate_parity.py` (the Python and TypeScript validators agree on the same good/bad files).

Manual checks on the built site (`npm run build`, then serve `app/dist/` from a subdirectory, for example copy it to `site/rashomon/` and run `npx serve site`, then open `/rashomon/`):

1. The demo loads with `150/150 model(s) satisfy…`; the lab-feature histograms (pafi, bili, bun, alb, urine, wblc) show spikes at the imputation constants.
2. Monotone ↗ on `age` leaves only the models whose age curve never steps down; the count, spread plot, rug and caption update.
3. Draw a rectangle on a curve plot and keep the matching models; Undo then Redo, and reload the page: the same models stay active.
4. Monotone on one feature hides model C; a rectangle on another feature matches B and C; disabling the first constraint in History makes C active again.
5. Zoom into a rank range, then add a constraint that removes the reference model: the zoom resets with a toast. Select a model, then hide it: the selection clears.
6. Constrain to zero models: every panel shows its empty state, Download is disabled, there are no NaN values, and Undo still works. Turn on "Only instances whose decision flips" and raise the threshold until nothing flips: "No instances match" shows with `reset`.
7. Constrain to one model, Download, then Upload that file: it loads with the labels, notes and threshold restored, an empty history, and the old constraints under "Inherited" in History.
