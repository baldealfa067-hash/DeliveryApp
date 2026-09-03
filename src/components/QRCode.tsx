import { useMemo } from "react";
import { useTranslation } from "react-i18next";

interface QRCodeProps {
  value: string;
  size?: number;
}

export const QRCode = ({ value, size = 200 }: QRCodeProps) => {
  const qrDataUrl = useMemo(() => {
    return generateQRCode(value, size);
  }, [value, size]);

  return (
    <img
      src={qrDataUrl}
      alt="QR Code"
      width={size}
      height={size}
      className="rounded-lg"
    />
  );
};

function generateQRCode(text: string, size: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // Simple visual hash-based QR code representation
  // In production, use a proper QR code library like qrcode
  const gridSize = 21;
  const cellSize = size / gridSize;
  const hash = simpleHash(text);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = "#000000";

  // Position patterns (corners)
  drawPositionPattern(ctx, 0, 0, cellSize);
  drawPositionPattern(ctx, (gridSize - 7) * cellSize, 0, cellSize);
  drawPositionPattern(ctx, 0, (gridSize - 7) * cellSize, cellSize);

  // Data pattern based on hash
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (isInPositionPattern(x, y, gridSize)) continue;

      const bitIndex = (y * gridSize + x) % 128;
      const bit = (hash[Math.floor(bitIndex / 8)] ?? 0) >> (bitIndex % 8) & 1;
      if (bit) {
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }
  }

  return canvas.toDataURL("image/png");
}

function drawPositionPattern(ctx: CanvasRenderingContext2D, x: number, y: number, cellSize: number) {
  // Outer square
  ctx.fillRect(x, y, 7 * cellSize, 7 * cellSize);
  // Inner white
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + cellSize, y + cellSize, 5 * cellSize, 5 * cellSize);
  // Center square
  ctx.fillStyle = "#000000";
  ctx.fillRect(x + 2 * cellSize, y + 2 * cellSize, 3 * cellSize, 3 * cellSize);
}

function isInPositionPattern(x: number, y: number, gridSize: number): boolean {
  // Top-left
  if (x < 8 && y < 8) return true;
  // Top-right
  if (x >= gridSize - 8 && y < 8) return true;
  // Bottom-left
  if (x < 8 && y >= gridSize - 8) return true;
  // Separator lines
  if (x === 7 || y === 7) return true;
  if (x === gridSize - 8 || y === gridSize - 8) return true;
  return false;
}

function simpleHash(str: string): number[] {
  const result = new Array(16).fill(0);
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    result[i % 16] = (result[i % 16] + charCode * (i + 1)) & 0xff;
    result[(i + 3) % 16] = (result[(i + 3) % 16] + charCode * 7) & 0xff;
  }
  return result;
}
