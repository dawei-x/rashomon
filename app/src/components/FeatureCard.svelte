<script lang="ts">
  import * as d3 from 'd3'
  import { session } from '../lib/session.svelte'
  import { segments, stepPoints } from '../lib/geometry'
  import { modelsInRect } from '../lib/constraints'
  import { escapeHtml, num } from '../lib/format'

  let { j }: { j: number } = $props()

  const SUGGESTED = ['inspect provenance', 'clean data', 'exclude', 'revisit', 'hard to measure', 'actionable', 'not admissible']
  const ML = 38
  const MR = 8
  const HH = 50 // histogram bar area
  const CH = 120 // curve plot
  const CY = HH + 14 // top of curve plot
  const SVG_H = CY + CH + 16

  let W = $state(300)
  const IW = $derived(Math.max(50, W - ML - MR))
  const ds = $derived(session.dataset!)
  const prep = $derived(session.prep!)
  const f = $derived(ds.features[j])
  const binary = $derived(f.type === 'binary')
  const dom = $derived(prep.xDomain[j])
  const x = $derived(d3.scaleLinear().domain(dom).range([0, IW]))
  const y = $derived(d3.scaleLinear().domain([-prep.yMax[j], prep.yMax[j]]).range([CH, 0]))

  // --- histogram (same bins for all instances and the visible subset)
  type Bar = { x0: number; x1: number; n: number }
  function histogram(rows: number[]): Bar[] {
    const vals = rows.map((i) => ds.data.rows[i][j])
    if (binary) {
      const ones = vals.filter((v) => v === 1).length
      return [
        { x0: 0, x1: 0.5, n: vals.length - ones },
        { x0: 0.5, x1: 1, n: ones },
      ]
    }
    const [lo, hi] = dom
    const edges = d3.range(1, 30).map((k) => lo + ((hi - lo) * k) / 30)
    return d3
      .bin()
      .domain([lo, hi])
      .thresholds(edges)(vals)
      .map((b) => ({ x0: b.x0!, x1: b.x1!, n: b.length }))
  }
  const allRows = $derived([...Array(prep.n).keys()])
  const bars = $derived(histogram(allRows))
  const subsetBars = $derived(session.instanceFilter.kind === 'none' ? null : histogram(session.visibleInstances))
  const maxCount = $derived(Math.max(1, ...bars.map((b) => b.n)))
  const hy = $derived(d3.scaleLinear().domain([0, maxCount]).range([HH, 0]))
  const selX = $derived.by(() => {
    if (session.selectedInstance === null) return null
    const v = ds.data.rows[session.selectedInstance][j]
    return binary ? (v === 1 ? 0.75 : 0.25) : v
  })

  // --- curves, computed once per dataset (only visibility changes)
  const paths = $derived.by(() => {
    const line = d3
      .line<[number, number]>()
      .x((p) => x(p[0]))
      .y((p) => y(p[1]))
      .curve(d3.curveStepAfter)
    const { B, offsets } = prep
    return ds.models.weights.map((row) => line(stepPoints(segments(f.thresholds, row.slice(offsets[j], offsets[j] + B[j]), dom).segments))!)
  })
  const xTicks = $derived(binary ? [] : x.ticks(5))

  let hovered = $state<number | null>(null)
  const others = $derived(session.activeModels.filter((m) => m !== session.refModel && m !== session.selectedModel))

  function lineTip(e: MouseEvent, m: number) {
    hovered = m
    const loss = ds.models.loss[m]
    session.tooltip = { x: e.clientX, y: e.clientY, html: `model ${escapeHtml(prep.modelIds[m])} · loss ${loss.toFixed(4)}` }
  }
  function lineLeave() {
    hovered = null
    session.tooltip = null
  }

  // --- rectangle filter mode
  const filterMode = $derived(session.filterModeFeature === f.name)
  let brushG = $state<SVGGElement>()
  let pending = $state<{ rect: [number, number, number, number]; modelIdx: number[]; px: number; py: number } | null>(null)
  let rationale = $state('')
  const pendingActive = $derived(pending ? pending.modelIdx.filter((m) => session.activeMask[m]) : [])
  const highlight = $derived(new Set(pendingActive))

  $effect(() => {
    if (!filterMode || !brushG) return
    const g = d3.select(brushG)
    const brush = d3
      .brush()
      .extent([
        [0, 0],
        [IW, CH],
      ])
      .on('end', (event: d3.D3BrushEvent<unknown>) => {
        if (!event.sourceEvent) return
        const s = event.selection as [[number, number], [number, number]] | null
        if (!s) {
          pending = null
          return
        }
        const [[px0, py0], [px1, py1]] = s
        const rect = { x0: x.invert(px0), x1: x.invert(px1), y0: y.invert(py1), y1: y.invert(py0) }
        pending = { rect: [rect.x0, rect.x1, rect.y0, rect.y1], modelIdx: modelsInRect(ds, j, dom, rect), px: px1, py: py0 }
      })
    g.call(brush)
    return () => {
      g.on('.brush', null).selectAll('*').remove()
      pending = null
    }
  })

  function finish(mode: 'keep' | 'exclude' | null) {
    if (mode && pending) {
      const [x0, x1, y0, y1] = pending.rect
      session.addFilter(f.name, mode, [x0, x1], [y0, y1], pending.modelIdx, rationale.trim() || undefined)
    }
    pending = null
    rationale = ''
    session.toggleFilterMode(null)
  }

  // --- labels and notes
  let labelOpen = $state(false)
  let notesOpen = $state(false)
  let labelText = $state('')
  const labels = $derived(session.labels[f.name] ?? [])
  const note = $derived(session.notes[f.name] ?? '')
  const mono = $derived(session.monotoneOf(f.name))

  function addLabel(l: string) {
    session.addLabel(f.name, l)
    labelText = ''
    labelOpen = false
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    if (filterMode) finish(null)
    labelOpen = false
    notesOpen = false
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="card" id="card-{j}" class:filtering={filterMode}>
  <div class="title">
    <span class="chip mono name">{f.name}</span>
    {#if f.unit}<span class="muted">{f.unit}</span>{/if}
    {#each labels as l (l)}
      <span class="chip">{l}<button aria-label="remove label" onclick={() => session.removeLabel(f.name, l)}>×</button></span>
    {/each}
    <div class="anchor">
      <button class="link small" onclick={() => (labelOpen = !labelOpen)}>+ label</button>
      {#if labelOpen}
        <div class="popover label-pop">
          {#each SUGGESTED.filter((s) => !labels.includes(s)) as s (s)}
            <button class="suggest" onclick={() => addLabel(s)}>{s}</button>
          {/each}
          <form
            onsubmit={(e) => {
              e.preventDefault()
              addLabel(labelText)
            }}
          >
            <!-- svelte-ignore a11y_autofocus -->
            <input placeholder="custom label…" bind:value={labelText} autofocus />
          </form>
        </div>
      {/if}
    </div>
  </div>

  <div class="body">
    <div class="gutter">
      <div class="anchor">
        <button class="icon" class:active={notesOpen} title="Notes" aria-label="Notes" onclick={() => (notesOpen = !notesOpen)}>
          <svg width="17" height="17" viewBox="0 0 14 14"
            ><path d="M3 1h6l3 3v9H3z M9 1v3h3 M5 7h5 M5 9.5h5" fill="none" stroke="currentColor" /></svg
          >
          {#if note}<span class="dot"></span>{/if}
        </button>
        {#if notesOpen}
          <div class="popover notes-pop">
            <!-- svelte-ignore a11y_autofocus -->
            <textarea
              rows="5"
              cols="32"
              placeholder="Notes about {f.name}…"
              value={note}
              autofocus
              onblur={(e) => {
                session.setNote(f.name, e.currentTarget.value)
                notesOpen = false
              }}
            ></textarea>
          </div>
        {/if}
      </div>
      <button
        class="icon mono-btn"
        class:on={mono !== null}
        title="Monotone constraint: {mono ?? 'none'} (click to cycle none → up → down)"
        aria-label="Monotone constraint"
        onclick={() => session.cycleMonotone(f.name)}>{mono === 'down' ? '↘' : '↗'}</button
      >
      <button
        class="icon"
        class:active={filterMode}
        title="Rectangle filter: drag on the curve plot"
        aria-label="Rectangle filter"
        onclick={() => session.toggleFilterMode(f.name)}
      >
        <svg width="17" height="17" viewBox="0 0 14 14"
          ><rect x="2" y="2" width="10" height="10" fill="none" stroke="currentColor" stroke-dasharray="2 1.5" /></svg
        >
      </button>
    </div>

    <div class="plots" bind:clientWidth={W}>
      <svg width={W} height={SVG_H} style="display:block">
        <!-- histogram -->
        <g transform="translate({ML},0)">
          {#each bars as b, k (k)}
            <rect x={x(b.x0) + 0.5} width={Math.max(0, x(b.x1) - x(b.x0) - 1)} y={hy(b.n)} height={HH - hy(b.n)} fill="var(--c-hist)" />
          {/each}
          {#if subsetBars}
            {#each subsetBars as b, k (k)}
              <rect x={x(b.x0) + 0.5} width={Math.max(0, x(b.x1) - x(b.x0) - 1)} y={hy(b.n)} height={HH - hy(b.n)} fill="var(--c-hist-subset)" />
            {/each}
          {/if}
          <line class="axis-line" x1="0" x2={IW} y1={HH} y2={HH} />
          <text x="-4" y="8" text-anchor="end">{maxCount}</text>
          {#if selX !== null}
            <path d="M{x(selX)},{HH + 1} l-4,7 h8 z" fill="black" />
          {/if}
        </g>

        <!-- curve plot -->
        <g transform="translate({ML},{CY})">
          <rect width={IW} height={CH} fill="#fbfbfb" />
          <line class="zero-line" x1="0" x2={IW} y1={y(0)} y2={y(0)} />
          {#each y.ticks(4) as t (t)}
            <text x="-4" y={y(t) + 3} text-anchor="end">{num(t)}</text>
          {/each}
          {#each xTicks as t (t)}
            <text x={x(t)} y={CH + 12} text-anchor="middle">{num(t)}</text>
          {/each}
          {#if binary}
            <text x={x(0.25)} y={CH + 12} text-anchor="middle">0</text>
            <text x={x(0.75)} y={CH + 12} text-anchor="middle">1</text>
          {/if}

          {#each others as m (m)}
            <path
              d={paths[m]}
              fill="none"
              stroke={highlight.has(m) ? 'var(--c-filter-hl)' : 'var(--c-model)'}
              stroke-opacity={highlight.has(m) ? 0.9 : 0.35}
              stroke-width={hovered === m ? 2 : 1}
            />
          {/each}
          {#if session.refModel !== null}
            <path d={paths[session.refModel]} fill="none" stroke={highlight.has(session.refModel) ? 'var(--c-filter-hl)' : 'var(--c-ref)'} stroke-width={hovered === session.refModel ? 2.5 : 1.5} />
          {/if}
          {#if session.selectedModel !== null}
            <path d={paths[session.selectedModel]} fill="none" stroke="var(--c-selected)" stroke-width="2" />
          {/if}

          {#if !filterMode}
            {#each session.activeModels as m (m)}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <path
                class="hit"
                d={paths[m]}
                onmousemove={(e) => lineTip(e, m)}
                onmouseleave={lineLeave}
                onclick={() => session.toggleSelectedModel(m)}
              />
            {/each}
          {/if}
          {#if filterMode}<g bind:this={brushG} class="brush"></g>{/if}
        </g>
      </svg>

      {#if pending}
        <div class="popover filter-pop" style:left="{Math.min(ML + pending.px + 6, W - 120)}px" style:top="{CY + pending.py}px">
          <div class="row">
            <button onclick={() => finish('keep')}>Keep only ({pendingActive.length})</button>
            <button onclick={() => finish('exclude')}>Exclude ({pendingActive.length})</button>
          </div>
          <input placeholder="rationale (optional)" bind:value={rationale} />
          <button class="link" onclick={() => finish(null)}>Cancel</button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .card {
    border: 1px solid var(--c-border);
    border-radius: var(--radius);
    padding: 6px 8px 4px;
    background: var(--c-panel);
  }
  .card.filtering {
    border-color: var(--c-filter-hl);
  }
  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-height: 22px;
  }
  .name {
    font-size: 12px;
    background: #e8eaee;
  }
  .small {
    font-size: 11px;
  }
  .anchor {
    position: relative;
  }
  .body {
    display: flex;
    gap: 4px;
  }
  .gutter {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 40px;
  }
  .gutter button {
    position: relative;
    width: 30px;
    height: 30px;
  }
  .dot {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--c-selected);
  }
  .mono-btn {
    color: var(--c-muted);
    font-size: 16px;
  }
  .mono-btn.on {
    background: var(--c-ref);
    color: white;
    border-color: var(--c-ref);
  }
  .plots {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 7;
    pointer-events: stroke;
    cursor: pointer;
  }
  .brush :global(.overlay) {
    cursor: crosshair;
  }
  .label-pop {
    top: 20px;
    left: 0;
    width: 220px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .label-pop form,
  .label-pop input {
    width: 100%;
  }
  .suggest {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 10px;
  }
  .notes-pop {
    left: 30px;
    top: 0;
  }
  .filter-pop {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 230px;
  }
  .filter-pop .row {
    display: flex;
    gap: 4px;
  }
</style>
