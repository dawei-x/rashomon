import{C as M,D as O,F as D,m as P,G as C,H as I,I as b,J as Y,K as W,M as $,N as T,O as g,P as A,Q as j,c as v,R as q,S as B,T as F,U as G,V as J,W as K,X as Q,a as U,p as X,h as E,g as z,k as Z}from"./runtime.Df29t-Yf.js";import{b as x}from"./disclose-version.Lgl9iNYB.js";const rr=["touchstart","touchmove"];function er(r){return rr.includes(r)}const V=new Set,S=new Set;function sr(r){for(var e=0;e<r.length;e++)V.add(r[e]);for(var t of S)t(r)}function m(r){var R;var e=this,t=e.ownerDocument,c=r.type,i=((R=r.composedPath)==null?void 0:R.call(r))||[],a=i[0]||r.target,d=0,_=r.__root;if(_){var u=i.indexOf(_);if(u!==-1&&(e===document||e===window)){r.__root=e;return}var h=i.indexOf(e);if(h===-1)return;u<=h&&(d=u)}if(a=i[d]||r.target,a!==e){M(r,"currentTarget",{configurable:!0,get(){return a||t}});var w=C,o=I;O(null),D(null);try{for(var n,s=[];a!==null;){var f=a.assignedSlot||a.parentNode||a.host||null;try{var l=a["__"+c];if(l!==void 0&&!a.disabled)if(P(l)){var[H,...L]=l;H.apply(a,[r,...L])}else l.call(a,r)}catch(y){n?s.push(y):n=y}if(r.cancelBubble||f===e||f===null)break;a=f}if(n){for(let y of s)queueMicrotask(()=>{throw y});throw n}}finally{r.__root=e,delete r.currentTarget,O(w),D(o)}}}function or(r,e){var t=e==null?"":typeof e=="object"?e+"":e;t!==(r.__t??(r.__t=r.nodeValue))&&(r.__t=t,r.nodeValue=t==null?"":t+"")}function ar(r,e){return k(r,e)}function ir(r,e){b(),e.intro=e.intro??!1;const t=e.target,c=E,i=v;try{for(var a=Y(t);a&&(a.nodeType!==8||a.data!==W);)a=$(a);if(!a)throw T;g(!0),A(a),j();const d=k(r,{...e,anchor:a});if(v===null||v.nodeType!==8||v.data!==q)throw B(),T;return g(!1),d}catch(d){if(d===T)return e.recover===!1&&F(),b(),G(t),g(!1),ar(r,e);throw d}finally{g(c),A(i)}}const p=new Map;function k(r,{target:e,anchor:t,props:c={},events:i,context:a,intro:d=!0}){b();var _=new Set,u=o=>{for(var n=0;n<o.length;n++){var s=o[n];if(!_.has(s)){_.add(s);var f=er(s);e.addEventListener(s,m,{passive:f});var l=p.get(s);l===void 0?(document.addEventListener(s,m,{passive:f}),p.set(s,1)):p.set(s,l+1)}}};u(J(V)),S.add(u);var h=void 0,w=K(()=>{var o=t??e.appendChild(Q());return U(()=>{if(a){X({});var n=Z;n.c=a}i&&(c.$$events=i),E&&x(o,null),h=r(o,c)||{},E&&(I.nodes_end=v),a&&z()}),()=>{var f;for(var n of _){e.removeEventListener(n,m);var s=p.get(n);--s===0?(document.removeEventListener(n,m),p.delete(n)):p.set(n,s)}S.delete(u),o!==t&&((f=o.parentNode)==null||f.removeChild(o))}});return N.set(h,w),h}let N=new WeakMap;function fr(r,e){const t=N.get(r);return t?(N.delete(r),t(e)):Promise.resolve()}export{sr as d,ir as h,ar as m,or as s,fr as u};
