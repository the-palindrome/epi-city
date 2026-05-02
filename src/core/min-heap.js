export class MinHeap {
  constructor(compare) {
    this.compare = compare
    this.items = []
  }

  get length() {
    return this.items.length
  }

  clear() {
    this.items.length = 0
  }

  push(item) {
    this.items.push(item)
    this.bubbleUp(this.items.length - 1)
  }

  pop() {
    const first = this.items[0]
    const last = this.items.pop()

    if (this.items.length > 0) {
      this.items[0] = last
      this.sinkDown(0)
    }

    return first
  }

  bubbleUp(index) {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)

      if (this.compare(this.items[index], this.items[parentIndex]) >= 0) {
        break
      }

      this.swap(index, parentIndex)
      index = parentIndex
    }
  }

  sinkDown(index) {
    while (true) {
      const leftIndex = index * 2 + 1
      const rightIndex = leftIndex + 1
      let smallestIndex = index

      if (leftIndex < this.items.length && this.compare(this.items[leftIndex], this.items[smallestIndex]) < 0) {
        smallestIndex = leftIndex
      }

      if (rightIndex < this.items.length && this.compare(this.items[rightIndex], this.items[smallestIndex]) < 0) {
        smallestIndex = rightIndex
      }

      if (smallestIndex === index) {
        break
      }

      this.swap(index, smallestIndex)
      index = smallestIndex
    }
  }

  swap(a, b) {
    const temp = this.items[a]
    this.items[a] = this.items[b]
    this.items[b] = temp
  }
}
