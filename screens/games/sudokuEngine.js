// Pure-JS Sudoku engine — no React Native imports. Grids are flat length-81
// arrays (row-major), 0 = empty. Exposes generate(difficulty) → { puzzle, solution }.

const GIVENS = { easy: 40, medium: 32, hard: 28 }

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// Can `val` go at flat index `pos` without breaking row/col/box?
function canPlace(grid, pos, val) {
  const r = Math.floor(pos / 9)
  const c = pos % 9
  for (let i = 0; i < 9; i++) {
    if (grid[r * 9 + i] === val) return false          // row
    if (grid[i * 9 + c] === val) return false          // col
  }
  const br = Math.floor(r / 3) * 3
  const bc = Math.floor(c / 3) * 3
  for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
    if (grid[(br + dr) * 9 + (bc + dc)] === val) return false   // box
  }
  return true
}

// Fill a complete valid solution via randomized backtracking.
function fillSolution(grid, pos = 0) {
  if (pos === 81) return true
  if (grid[pos] !== 0) return fillSolution(grid, pos + 1)
  const vals = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])
  for (const v of vals) {
    if (canPlace(grid, pos, v)) {
      grid[pos] = v
      if (fillSolution(grid, pos + 1)) return true
      grid[pos] = 0
    }
  }
  return false
}

// Count solutions, but stop early once `cap` is reached.
function countSolutions(grid, cap = 2) {
  let count = 0
  const work = [...grid]
  function solve(pos) {
    if (count >= cap) return
    while (pos < 81 && work[pos] !== 0) pos++
    if (pos === 81) { count++; return }
    for (let v = 1; v <= 9; v++) {
      if (canPlace(work, pos, v)) {
        work[pos] = v
        solve(pos + 1)
        work[pos] = 0
        if (count >= cap) return
      }
    }
  }
  solve(0)
  return count
}

export function generate(difficulty = 'easy') {
  const target = GIVENS[difficulty] ?? GIVENS.easy

  const solution = new Array(81).fill(0)
  fillSolution(solution)

  const puzzle = [...solution]
  let givens = 81
  const order = shuffle([...Array(81).keys()])
  for (const pos of order) {
    if (givens <= target) break
    const backup = puzzle[pos]
    puzzle[pos] = 0
    if (countSolutions(puzzle, 2) !== 1) puzzle[pos] = backup   // restore — not unique
    else givens--
  }

  return { puzzle, solution }
}
