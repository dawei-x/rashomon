<script lang="ts">
  import * as d3 from 'd3'
  import { session } from '../lib/session.svelte'
  import { contributions } from '../lib/model'
  import { escapeHtml, fixed, num, signedTerm } from '../lib/format'
  import HelpTip from './HelpTip.svelte'

  const GROUP_W = 46
  const H = 150
  const M = { top: 8, bottom: 30, left: 40 }

  const ds = $derived(session.dataset!)
  const prep = $derived(session.prep!)
  const i = $derived(session.selectedInstance)

  type Role = { key: string; label: string; color: string; opacity: number; m: number }
  // Reference, min, max (only when they differ from the reference), then the selected model.
  const roles = $derived.by((): Role[] => {
    const s = session.spread
    if (i === null || !s || session.refModel === null) return []
    const ref = session.refModel
    const out: Role[] = [{ key: 'ref', label: 'p_ref', color: 'var(--c-ref)', opacity: 0.6, m: ref }]
    if (s.minModel[i] !== ref) out.push({ key: 'min', label: 'p_min', color: 'var(--c-min)', opacity: 1, m: s.minModel[i] })
    if (s.maxModel[i] !== ref) out.push({ key: 'max', label: 'p_max', color: 'var(--c-max)', opacity: 1, m: s.maxModel[i] })
    if (session.selectedModel !== null)
      out.push({ key: 'sel', label: 'p_selected', color: 'var(--c-selected)', opacity: 1, m: session.selectedModel })
    return out
  })
  const contrib = $derived(i === null ? [] : roles.map((r) => contributions(ds, prep.offsets, prep.binIndex, r.m, i)))
  const yMax = $derived(Math.max(0.1, ...contrib.flat().map(Math.abs)))
  const ih = H - M.top - M.bottom
  const y = $derived(d3.scaleLinear().domain([-yMax, yMax]).range([ih, 0]))
  const order = $derived(prep.featureOrder)
  const width = $derived(M.left + order.length * GROUP_W + 8)
  const barW = $derived(Math.min(9, (GROUP_W - 8) / Math.max(1, roles.length)))

  function tip(e: MouseEvent, r: Role, j: number, c: number) {
    const f = ds.features[j]
    session.tooltip = {
      x: e.clientX,
      y: e.clientY,
      html: `${r.label.replace('p_', '')} · ${escapeHtml(f.name)} = ${num(ds.data.rows[i!][j])} → ${fixed(c, 3)}`,
    }
  }

  function formula(r: Role, c: number[]): string {
    const b = ds.models.intercepts[r.m]
    const terms = order.map((j) => signedTerm(c[j])).join(' ')
    const p = prep.P[r.m * prep.n + i!]
    return `σ(${fixed(b, 2)} ${terms}) = ${p.toFixed(3)}`
  }
</script>

<section class="panel">
  <div class="panel-header">
    <h2>Instance{i !== null ? ` (${prep.instanceIds[i]})` : ''}</h2>
    <HelpTip
      text="Each feature's contribution to this instance's score under the reference model, the models giving the lowest and highest predicted probability, and the selected model. The formulas below add the intercept and the contributions, in the same feature order, and apply the logistic function σ."
    />
    {#if i !== null && ds.data.y}
      <span class="muted">observed {ds.target?.label_names?.[String(ds.data.y[i])] ?? ds.data.y[i]}</span>
    {/if}
  </div>

  {#if i === null}
    <p class="empty">Click an instance in the plot above.</p>
  {:else if session.activeCount === 0}
    <p class="empty">No models satisfy the constraints.</p>
  {:else}
    <div class="body">
      <div class="chart">
        <svg {width} height={H}>
          <g transform="translate({M.left},{M.top})">
            {#each y.ticks(4) as t (t)}
              <text x="-4" y={y(t) + 3} text-anchor="end">{fixed(t, 1)}</text>
            {/each}
            <line class="zero-line" x1="0" x2={order.length * GROUP_W} y1={y(0)} y2={y(0)} />
            {#each order as j, g (j)}
              {@const gx = g * GROUP_W + (GROUP_W - roles.length * barW) / 2}
              {#each roles as r, k (r.key)}
                {@const c = contrib[k][j]}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect
                  x={gx + k * barW}
                  width={barW - 1}
                  y={Math.min(y(0), y(c))}
                  height={Math.max(0.5, Math.abs(y(c) - y(0)))}
                  fill={r.color}
                  fill-opacity={r.opacity}
                  onmousemove={(e) => tip(e, r, j, c)}
                  onmouseleave={() => (session.tooltip = null)}
                />
              {/each}
              <text x={g * GROUP_W + GROUP_W / 2} y={ih + 12} text-anchor="middle" class="flabel">{ds.features[j].name}</text>
              <text x={g * GROUP_W + GROUP_W / 2} y={ih + 23} text-anchor="middle">({num(ds.data.rows[i][j])})</text>
            {/each}
          </g>
        </svg>
      </div>
      <div class="formulas mono">
        {#each roles as r, k (r.key)}
          <div class="formula">
            <span class="lbl" style:color={r.color}>{r.label}</span>
            <span class="muted">[{prep.modelIds[r.m]}]</span> = {formula(r, contrib[k])}
            {#if r.key === 'sel'}
              <button class="clear" aria-label="clear selected model" onclick={() => session.toggleSelectedModel(null)}>×</button>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</section>

<style>
  .body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    overflow: hidden;
  }
  .chart {
    overflow-x: auto;
    padding: 4px 8px 0;
    flex-shrink: 0;
  }
  .flabel {
    fill: var(--c-text);
  }
  .formulas {
    overflow: auto;
    padding: 6px 12px 10px;
    font-size: 11.5px;
    flex: 1;
    min-height: 0;
  }
  .formula {
    margin-bottom: 4px;
    word-break: break-word;
  }
  .lbl {
    font-weight: 700;
  }
  .clear {
    border: none;
    padding: 0 4px;
    color: var(--c-muted);
  }
</style>
