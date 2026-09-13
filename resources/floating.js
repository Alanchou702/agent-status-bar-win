'use strict';
if (new URLSearchParams(location.search).get('floating') === '1') {
  document.documentElement.classList.add('floating');
  const api = window.agentBar;
  const compact = document.getElementById('floating-compact');
  const panel = document.querySelector('.panel');
  let dragging = false;
  let version = 0;
  let movePending = false;
  const pointer = action => api?.pointer(action).catch(() => {});
  panel.inert = true;
  api?.onShell(shell => {
    const current = ++version;
    const style = document.documentElement.style;
    style.setProperty('--compact-x', shell.compactX + 'px');
    style.setProperty('--compact-y', shell.compactY + 'px');
    style.setProperty('--clip-top', (shell.compactY + 2) + 'px');
    style.setProperty('--clip-left', shell.compactX + 'px');
    style.setProperty('--clip-right', Math.max(0, shell.width - 360 - shell.compactX) + 'px');
    style.setProperty('--clip-bottom', Math.max(0, shell.height - 52 - shell.compactY) + 'px');
    panel.inert = !shell.expanded;
    compact.inert = shell.expanded;
    if (shell.expanded) requestAnimationFrame(() => requestAnimationFrame(() => {
      if (current === version) document.documentElement.classList.add('shell-expanded');
    }));
    else document.documentElement.classList.remove('shell-expanded');
  });
  const renderFloatingState = data => {
    for (const client of ['claude', 'codex']) {
      const row = document.getElementById('floating-' + client);
      const state = data?.agents?.find(agent => agent.client === client)?.status;
      row.dataset.state = data?.paused ? 'paused' : state?.state || 'idle';
      row.querySelector('.floating-state').textContent = data?.paused ? '已暂停' : state?.label || '未运行';
    }
  };
  api?.onState(renderFloatingState);
  api?.getState().then(renderFloatingState).catch(() => {});
  compact.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    dragging = true;
    compact.setPointerCapture(event.pointerId);
    compact.classList.add('dragging');
    pointer('drag-start');
    event.preventDefault();
  });
  compact.addEventListener('pointermove', () => {
    if (!dragging || movePending) return;
    movePending = true;
    requestAnimationFrame(() => { movePending = false; if (dragging) pointer('drag-move'); });
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false; compact.classList.remove('dragging'); pointer('drag-end');
  }
  compact.addEventListener('pointerup', endDrag);
  compact.addEventListener('pointercancel', endDrag);
  compact.addEventListener('lostpointercapture', endDrag);
}

