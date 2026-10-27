<script lang="ts">
  import * as d3 from 'd3'
  import { session } from '../lib/session.svelte'
  import { escapeHtml, fixed, pct } from '../lib/format'
  import HelpTip from './HelpTip.svelte'

  const M = { top: 10, right: 12, bottom: 34, left: 62 }

  let width = $state(600)
  let height = $state(300)
  let canvas = $state<HTMLCanvasElement>()
  let brushG = $state<SVGGElement>()
  let pillG = $state<SVGGElement>()
  let hover = $state<number | null>(null)

  const prep = $derived(session.prep!)
  const iw = $derived(Math.max(10, width - M.left - M.right))
  const ih = $derived(Math.max(10, height - M.top - M.bottom))
  const f = $derived(session.instanceFilter)
  const xDom = $derived.by((): [number, number] => {
    if (f.kind === 'rankRange') return f.lo === f.hi ? [f.lo - 0.5, f.hi + 0.5] : [f.lo, f.hi]
    return prep.n === 1 ? [0.5, 1.5] : [1, prep.n]
  })
  const x = $derived(d3.scaleLinear().domain(xDom).range([0, iw]))
  const y = $derived(d3.scaleLinear().domain([0, 1]).range([ih, 0]))
  const visible = $derived(session.visibleInstances)
  const rankOf = $derived(session.ranks?.rankOf)
  const hasModels = $derived(session.activeCount > 0)

  function linePath(m: number): string {
    if (!rankOf) return ''
    const P = prep.P
    const base = m * prep.n
    return visible.map((i, k) => `${k ? 'L' : 'M'}${x(rankOf[i]).toFixed(1)},${y(P[base + i]).toFixed(1)}`).join('')
  }

  // Model polylines on canvas; redrawn when active models, visible instances, selection or size change.
  $effect(() => {
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = iw * dpr
    canvas.height = ih * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, iw, ih)
    if (!rankOf || visible.length === 0) return
    const P = prep.P
    const n = prep.n
    const xs = visible.map((i) => x(rankOf[i]))
    ctx.strokeStyle = 'rgba(184,184,184,0.25)'
    ctx.lineWidth = 0.8
    for (const m of session.activeModels) {
      if (m === session.refModel || m === session.selectedModel) continue
      ctx.beginPath()
      for (let k = 0; k < visible.length; k++) {
        const py = y(P[m * n + visible[k]])
        if (k === 0) ctx.moveTo(xs[k], py)
        else ctx.lineTo(xs[k], py)
      }
      ctx.stroke()
    }
  })

  // Rank brush; a click without a drag selects the nearest instance.
  function nearest(px: number): number | null {
    if (!rankOf || visible.length === 0) return null
    const r = x.invert(px)
    let best = visible[0]
    for (const i of visible) if (Math.abs(rankOf[i] - r) < Math.abs(rankOf[best] - r)) best = i
    return best
  }

  $effect(() => {
    if (!brushG) return
    const g = d3.select(brushG)
    const brush = d3
      .brushX()
      .extent([
        [0, 0],
        [iw, ih],
      ])
      .on('end', (event: d3.D3BrushEvent<unknown>) => {
        if (!event.sourceEvent) return
        const s = event.selection as [number, number] | null
        if (!s || s[1] - s[0] < 3) {
          const [px] = d3.pointer(event.sourceEvent, brushG)
          const i = nearest(px)
          // clicking the selected instance again deselects it
          if (i !== null) session.selectInstance(i === session.selectedInstance ? null : i)
        } else {
          const lo = Math.max(Math.ceil(x.invert(s[0])), 1)
          const hi = Math.min(Math.floor(x.invert(s[1])), prep.n)
          if (lo <= hi) session.setRankRange(lo, hi)
        }
        if (s) g.call(brush.move, null)
      })
    g.call(brush)
    g.on('mousemove.hover', (e: MouseEvent) => {
      const [px] = d3.pointer(e, brushG)
      hover = nearest(px)
      if (hover === null || !session.spread) return (session.tooltip = null)
      const s = session.spread
      session.tooltip = {
        x: e.clientX,
        y: e.clientY,
        html:
          `instance ${escapeHtml(prep.instanceIds[hover])} · p_ref ${s.pRef[hover].toFixed(3)} · ` +
          `range [${s.pMin[hover].toFixed(3)}, ${s.pMax[hover].toFixed(3)}] · spread ${(s.pMax[hover] - s.pMin[hover]).toFixed(3)}`,
      }
    })
    g.on('mouseleave.hover', () => {
      hover = null
      session.tooltip = null
    })
    return () => {
      g.on('.brush', null).on('.hover', null).selectAll('*').remove()
    }
  })

  // Threshold pill: drag to move (snap 0.01), double-click to type.
  let editing = $state(false)
  $effect(() => {
    if (!pillG) return
    const yScale = y
    const g = d3.select(pillG)
    g.call(d3.drag<SVGGElement, unknown>().on('drag', (event) => session.setThreshold(yScale.invert(event.y))))
    return () => {
      g.on('.drag', null)
    }
  })
  function commitTau(e: Event) {
    const v = parseFloat((e.currentTarget as HTMLInputElement).value)
    if (Number.isFinite(v)) session.setThreshold(v)
    editing = false
  }
</script>

<section class="panel">
  <div class="panel-header">
    <h2>Predicted probability by instance</h2>
    <HelpTip
      text="Instances (x) are sorted by the reference model's predicted probability. Each grey line is one model in the set; the dark line is the reference model. Where the lines cross the red threshold, the yes/no decision depends on which model is chosen; red ticks under the axis mark those instances. Drag across the plot to zoom into a rank range; click to inspect an instance."
    />
  </div>
  <div class="caption">
    {#if !hasModels}
      <span>No models satisfy the constraints.</span>
    {:else}
      <span>
        With <strong>{session.threshold.toFixed(2)}</strong> as the threshold, choosing an alternate model from the set would lead
        to a different decision for <strong>{pct(session.flipPct!)}%</strong> ({session.flipCount}/{prep.n}) of instances.
      </span>
    {/if}
    <span class="controls">
      Showing {session.nVisible} of {prep.n}
      {#if f.kind !== 'none'}<button class="link" onclick={() => session.resetInstanceFilter()}>reset</button>{/if}
      <label>
        <input
          type="checkbox"
          checked={f.kind === 'flippedOnly'}
          disabled={!hasModels}
          onchange={(e) => session.setFlipsOnly(e.currentTarget.checked)}
        />
        Only instances whose decision flips
      </label>
    </span>
  </div>

  <div class="chart" bind:clientWidth={width} bind:clientHeight={height}>
    <canvas bind:this={canvas} style:left="{M.left}px" style:top="{M.top}px" style:width="{iw}px" style:height="{ih}px"></canvas>
    <svg {width} {height}>
      <g transform="translate({M.left},{M.top})">
        {#each y.ticks(5) as t (t)}
          <line x1="0" x2={iw} y1={y(t)} y2={y(t)} stroke="#f0f0f0" />
          <text x="-4" y={y(t) + 3} text-anchor="end">{fixed(t, 1)}</text>
        {/each}
        <line class="axis-line" x1="0" x2={iw} y1={ih} y2={ih} />
        {#each x.ticks(8).filter(Number.isInteger) as t (t)}
          <text x={x(t)} y={ih + 22} text-anchor="middle">{t}</text>
        {/each}
        <text x={iw / 2} y={ih + 33} text-anchor="middle">rank by reference model</text>

        {#if hasModels && rankOf}
          <!-- rug of flipped instances -->
          {#each visible as i (i)}
            {#if session.flips?.[i]}
              <line x1={x(rankOf[i])} x2={x(rankOf[i])} y1={ih + 2} y2={ih + 8} stroke="var(--c-flip)" />
            {/if}
          {/each}
          {#if session.refModel !== null}
            <path d={linePath(session.refModel)} fill="none" stroke="var(--c-ref)" stroke-width="1.5" />
          {/if}
          {#if session.selectedModel !== null}
            <path d={linePath(session.selectedModel)} fill="none" stroke="var(--c-selected)" stroke-width="1.5" />
          {/if}
          {#if session.selectedInstance !== null && visible.includes(session.selectedInstance)}
            {@const sx = x(rankOf[session.selectedInstance])}
            <line x1={sx} x2={sx} y1="0" y2={ih} stroke="#555" stroke-width="1.5" />
          {/if}
          {#if hover !== null}
            <line x1={x(rankOf[hover])} x2={x(rankOf[hover])} y1="0" y2={ih} stroke="#999" stroke-dasharray="2 2" />
          {/if}
        {/if}

        <line x1="0" x2={iw} y1={y(session.threshold)} y2={y(session.threshold)} stroke="var(--c-threshold)" stroke-dasharray="5 3" />
        <g bind:this={brushG}></g>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <g bind:this={pillG} class="pill" transform="translate(-60,{y(session.threshold)})" ondblclick={() => (editing = true)}>
          <rect x="0" y="-8" width="34" height="16" rx="8" fill="var(--c-threshold)" />
          <text x="17" y="4" text-anchor="middle" fill="white">{session.threshold.toFixed(2)}</text>
        </g>
        {#if hasModels && session.nVisible === 0}
          <text class="nomatch" x={iw / 2} y={ih / 2} text-anchor="middle">No instances match</text>
        {/if}
      </g>
    </svg>
    {#if editing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="tau-input"
        style:left="{M.left - 60}px"
        style:top="{M.top + y(session.threshold) - 10}px"
        type="number"
        min="0.01"
        max="0.99"
        step="0.01"
        value={session.threshold.toFixed(2)}
        autofocus
        onblur={commitTau}
        onkeydown={(e) => {
          if (e.key === 'Enter') commitTau(e)
          if (e.key === 'Escape') editing = false
        }}
      />
    {/if}
  </div>
</section>

<style>
  .caption {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    padding: 6px 12px 0;
    align-items: baseline;
  }
  .controls {
    display: flex;
    gap: 10px;
    align-items: baseline;
    color: var(--c-muted);
    margin-left: auto;
  }
  .controls label {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .chart {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  canvas,
  svg {
    position: absolute;
    left: 0;
    top: 0;
  }
  .pill {
    cursor: ns-resize;
  }
  .pill text {
    fill: white;
    font-weight: 600;
  }
  .nomatch {
    font-size: 14px;
  }
  .tau-input {
    position: absolute;
    width: 64px;
  }
</style>
