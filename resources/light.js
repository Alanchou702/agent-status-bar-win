'use strict';
let previous = '';
window.agentBar?.onLight(state => {
  if (!state || state.state === previous) return;
  previous = state.state;
  document.getElementById('housing').dataset.state = state.state;
  document.getElementById('label').textContent = state.label || '状态不可用';
});

