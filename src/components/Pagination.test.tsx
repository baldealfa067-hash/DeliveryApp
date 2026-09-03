import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Pagination } from "./Pagination";

describe("Pagination", () => {
  it("returns null when there is only one page", () => {
    const { container } = render(
      <Pagination page={1} pageCount={1} total={3} onPageChange={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the total count and current page", () => {
    render(<Pagination page={2} pageCount={3} total={25} onPageChange={() => {}} />);
    expect(screen.getByText("25 resultados")).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("shows singular for a single result", () => {
    render(<Pagination page={1} pageCount={1} total={1} onPageChange={() => {}} />);
    expect(screen.queryByText("1 resultado")).toBeNull();
  });

  it("disables the previous button on the first page", () => {
    render(<Pagination page={1} pageCount={3} total={25} onPageChange={() => {}} />);
    expect(screen.getByLabelText("Página anterior")).toBeDisabled();
    expect(screen.getByLabelText("Próxima página")).toBeEnabled();
  });

  it("disables the next button on the last page", () => {
    render(<Pagination page={3} pageCount={3} total={25} onPageChange={() => {}} />);
    expect(screen.getByLabelText("Página anterior")).toBeEnabled();
    expect(screen.getByLabelText("Próxima página")).toBeDisabled();
  });

  it("calls onPageChange with the previous page", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} pageCount={3} total={25} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByLabelText("Página anterior"));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("calls onPageChange with the next page", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} pageCount={3} total={25} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByLabelText("Próxima página"));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("does not call onPageChange when clicking a disabled button", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={1} pageCount={3} total={25} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByLabelText("Página anterior"));
    expect(onPageChange).not.toHaveBeenCalled();
  });
});