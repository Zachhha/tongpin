'use strict';

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function generateSeeds(n) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const seeds = [];
    const used = new Set();
    for (let r = 0; r < n; r += 1) {
      const options = [];
      for (let c = 0; c < n; c += 1) {
        if (used.has(c)) continue;
        if (seeds.some((s) => Math.abs(s.r - r) <= 1 && Math.abs(s.c - c) <= 1)) continue;
        options.push(c);
      }
      if (!options.length) break;
      const c = options[Math.floor(Math.random() * options.length)];
      used.add(c);
      seeds.push({ r, c });
    }
    if (seeds.length === n) return seeds;
  }
  return null;
}

function generateRegions(n, seeds) {
  const regions = Array.from({ length: n }, () => Array(n).fill(-1));
  const queue = [];
  seeds.forEach((s, id) => {
    regions[s.r][s.c] = id;
    queue.push({ r: s.r, c: s.c, id });
  });
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  while (queue.length) {
    const at = Math.floor(Math.random() * queue.length);
    const { r, c, id } = queue.splice(at, 1)[0];
    for (const [dr, dc] of shuffle([...dirs])) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= n || nc < 0 || nc >= n || regions[nr][nc] !== -1) continue;
      if (Math.random() < 0.14) {
        queue.push({ r, c, id });
        continue;
      }
      regions[nr][nc] = id;
      queue.push({ r: nr, c: nc, id });
    }
  }
  return regions;
}

function buildRegionCells(n, regions) {
  const cells = Array.from({ length: n }, () => []);
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) cells[regions[r][c]].push({ r, c });
  return cells;
}

function solve(n, regions, limit = 2, blocked = new Set()) {
  const regionCells = buildRegionCells(n, regions);
  if (regionCells.some((cells) => !cells.length)) return [];
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => regionCells[a].length - regionCells[b].length);
  const ordered = order.map((i) => regionCells[i]);
  const found = [];
  function backtrack(slot, rowMask, colMask, last) {
    if (found.length >= limit) return;
    if (slot === n) {
      found.push(last.map((cell) => ({ ...cell })));
      return;
    }
    for (const cell of ordered[slot]) {
      const index = cell.r * n + cell.c;
      if (blocked.has(index)) continue;
      const rBit = 1 << cell.r;
      const cBit = 1 << cell.c;
      if ((rowMask & rBit) || (colMask & cBit)) continue;
      if (last.some((cow) => Math.abs(cow.r - cell.r) <= 1 && Math.abs(cow.c - cell.c) <= 1)) continue;
      last.push(cell);
      backtrack(slot + 1, rowMask | rBit, colMask | cBit, last);
      last.pop();
    }
  }
  backtrack(0, 0, 0, []);
  return found;
}

function cellKey(cell) {
  return cell.r * 100 + cell.c;
}

function sameSolution(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const set = new Set(a.map(cellKey));
  return b.every((cell) => set.has(cellKey(cell)));
}

function regionConnected(n, regions, id) {
  const cells = [];
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (regions[r][c] === id) cells.push({ r, c });
  if (!cells.length) return false;
  const set = new Set(cells.map(cellKey));
  const seen = new Set([cellKey(cells[0])]);
  const queue = [cells[0]];
  while (queue.length) {
    const { r, c } = queue.pop();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
      const key = nr * 100 + nc;
      if (set.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push({ r: nr, c: nc });
      }
    }
  }
  return seen.size === cells.length;
}

function allConnected(n, regions) {
  for (let id = 0; id < n; id += 1) if (!regionConnected(n, regions, id)) return false;
  return true;
}

function fixMulti(n, regions, solA, solB) {
  const setA = new Set(solA.map(cellKey));
  for (const cell of solB) {
    if (setA.has(cellKey(cell))) continue;
    const { r, c } = cell;
    const current = regions[r][c];
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
      const next = regions[nr][nc];
      if (next === current) continue;
      regions[r][c] = next;
      if (regionConnected(n, regions, current) && regionConnected(n, regions, next)) return true;
      regions[r][c] = current;
    }
  }
  return false;
}

function blockToUnique(n, regions, seeds, maxBlocks = 90) {
  const blocked = new Set();
  const baseSet = new Set(seeds.map((cell) => cell.r * n + cell.c));
  for (let attempt = 0; attempt < maxBlocks; attempt += 1) {
    const solutions = solve(n, regions, 2, blocked);
    if (solutions.length === 1) return blocked;
    const alternative = solutions.find((sol) => sol.some((cell) => !baseSet.has(cell.r * n + cell.c)));
    if (!alternative) return null;
    const candidates = alternative
      .map((cell) => cell.r * n + cell.c)
      .filter((index) => !baseSet.has(index) && !blocked.has(index));
    if (!candidates.length) return null;
    blocked.add(candidates[candidates.length - 1]);
  }
  return solve(n, regions, 2, blocked).length === 1 ? blocked : null;
}

function generatePuzzle(n) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const seeds = generateSeeds(n);
    if (!seeds) continue;
    const regions = generateRegions(n, seeds);
    let solutions = solve(n, regions, 2);
    if (solutions.length === 0) continue;
    if (solutions.length === 1 && sameSolution(seeds, solutions[0]) && allConnected(n, regions)) {
      return { size: n, solution: seeds.map((s) => s.r * n + s.c), regions: regions.flat(), blocked: [] };
    }
    for (let fix = 0; fix < 20 && solutions.length >= 2; fix += 1) {
      if (!fixMulti(n, regions, solutions[0], solutions[1])) break;
      solutions = solve(n, regions, 2);
      if (solutions.length === 1 && allConnected(n, regions)) {
        return { size: n, solution: solutions[0].map((s) => s.r * n + s.c), regions: regions.flat(), blocked: [] };
      }
    }
    if (allConnected(n, regions)) {
      const blocked = blockToUnique(n, regions, seeds);
      if (blocked) {
        return {
          size: n,
          solution: seeds.map((s) => s.r * n + s.c),
          regions: regions.flat(),
          blocked: [...blocked],
        };
      }
    }
  }
  throw new Error('puzzle generation failed');
}

module.exports = { generatePuzzle };
