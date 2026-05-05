export class IndexPriorityQueue {
  constructor(initialCapacity = 16) {
    const capacity = Math.max(1, initialCapacity)

    this.indexes = new Int32Array(capacity)
    this.priorities = new Int32Array(capacity)
    this.length = 0
  }

  clear() {
    this.length = 0
  }

  push(index, priority) {
    this.ensureCapacity(this.length + 1)

    let cursor = this.length

    this.length += 1

    while (cursor > 0) {
      const parent = (cursor - 1) >> 1

      if (this.priorities[parent] <= priority) {
        break
      }

      this.indexes[cursor] = this.indexes[parent]
      this.priorities[cursor] = this.priorities[parent]
      cursor = parent
    }

    this.indexes[cursor] = index
    this.priorities[cursor] = priority
  }

  pop() {
    const firstIndex = this.indexes[0]
    const lastIndex = this.indexes[this.length - 1]
    const lastPriority = this.priorities[this.length - 1]

    this.length -= 1

    if (this.length > 0) {
      this.sinkRoot(lastIndex, lastPriority)
    }

    return firstIndex
  }

  sinkRoot(index, priority) {
    let cursor = 0

    while (true) {
      const left = cursor * 2 + 1

      if (left >= this.length) {
        break
      }

      const right = left + 1
      let child = left

      if (right < this.length && this.priorities[right] < this.priorities[left]) {
        child = right
      }

      if (this.priorities[child] >= priority) {
        break
      }

      this.indexes[cursor] = this.indexes[child]
      this.priorities[cursor] = this.priorities[child]
      cursor = child
    }

    this.indexes[cursor] = index
    this.priorities[cursor] = priority
  }

  ensureCapacity(size) {
    if (size <= this.indexes.length) {
      return
    }

    const nextCapacity = Math.max(size, this.indexes.length * 2)
    const nextIndexes = new Int32Array(nextCapacity)
    const nextPriorities = new Int32Array(nextCapacity)

    nextIndexes.set(this.indexes)
    nextPriorities.set(this.priorities)
    this.indexes = nextIndexes
    this.priorities = nextPriorities
  }
}
