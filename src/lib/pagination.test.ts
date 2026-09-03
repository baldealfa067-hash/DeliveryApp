import { describe, it, expect } from "vitest";
import { getPageCount, paginateArray } from "./pagination";

describe("getPageCount", () => {
  it("returns 1 when there are no items", () => {
    expect(getPageCount(0, 10)).toBe(1);
  });

  it("returns 1 when total is less than or equal to page size", () => {
    expect(getPageCount(5, 10)).toBe(1);
    expect(getPageCount(10, 10)).toBe(1);
  });

  it("rounds up partial pages", () => {
    expect(getPageCount(11, 10)).toBe(2);
    expect(getPageCount(21, 10)).toBe(3);
  });

  it("handles a page size of 1", () => {
    expect(getPageCount(5, 1)).toBe(5);
  });
});

describe("paginateArray", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  it("returns the first page by default", () => {
    expect(paginateArray(items, 1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns the correct middle page", () => {
    expect(paginateArray(items, 2, 5)).toEqual([6, 7, 8, 9, 10]);
  });

  it("returns the remainder on the last page", () => {
    expect(paginateArray(items, 3, 5)).toEqual([11, 12]);
  });

  it("returns an empty array when page is out of range", () => {
    expect(paginateArray(items, 4, 5)).toEqual([]);
    expect(paginateArray(items, 0, 5)).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(paginateArray([], 1, 10)).toEqual([]);
  });

  it("returns all items when page size is larger than the list", () => {
    expect(paginateArray(items, 1, 100)).toEqual(items);
  });
});