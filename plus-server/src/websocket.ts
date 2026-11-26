import { createHash } from "node:crypto";

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

/**
 * A minimal RFC 6455 WebSocket server endpoint (text frames only), enough for
 * the scene realtime channel without pulling in a dependency. Handles the
 * upgrade handshake, masking, fragmentation, ping/pong and close.
 */

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** Largest message accepted (scenes can carry base64 images). */
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

export type WebSocketConnection = {
  send: (text: string) => void;
  /** Bytes queued on the socket but not yet flushed (for backpressure). */
  bufferedAmount: () => number;
  ping: () => void;
  close: (code?: number, reason?: string) => void;
  /** True once a pong (or any frame) arrived since the last `ping()`. */
  alive: () => boolean;
  onMessage: (handler: (text: string) => void) => void;
  onClose: (handler: () => void) => void;
};

const encodeFrame = (opcode: number, payload: Buffer) => {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
};

/**
 * Completes the handshake on an `upgrade` request. Returns null (after
 * answering with an HTTP error) if the request isn't a valid WebSocket one.
 */
export const acceptWebSocket = (
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): WebSocketConnection | null => {
  const key = req.headers["sec-websocket-key"];
  if (
    req.headers.upgrade?.toLowerCase() !== "websocket" ||
    typeof key !== "string" ||
    req.headers["sec-websocket-version"] !== "13"
  ) {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return null;
  }
  const accept = createHash("sha1")
    .update(key + GUID)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"),
  );
  // frames are small and latency-sensitive: don't wait to coalesce them
  (socket as any).setNoDelay?.(true);
  (socket as any).setTimeout?.(0);

  let messageHandler: (text: string) => void = () => {};
  let closeHandler: () => void = () => {};
  let closed = false;
  let sawFrame = true;
  let buffer: Buffer = head.length ? Buffer.from(head) : Buffer.alloc(0);
  let fragments: Buffer[] = [];
  let fragmentBytes = 0;

  const finish = () => {
    if (!closed) {
      closed = true;
      closeHandler();
    }
  };

  const write = (opcode: number, payload: Buffer) => {
    if (!closed && !socket.destroyed && socket.writable) {
      socket.write(encodeFrame(opcode, payload));
    }
  };

  const close = (code = 1000, reason = "") => {
    if (closed) {
      return;
    }
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    write(OP_CLOSE, payload);
    // give the close frame a moment to flush, then drop the socket
    socket.end();
    finish();
  };

  const fail = (code: number, reason: string) => close(code, reason);

  const handleFrame = (fin: boolean, opcode: number, payload: Buffer) => {
    sawFrame = true;
    switch (opcode) {
      case OP_PING:
        write(OP_PONG, payload);
        return;
      case OP_PONG:
        return;
      case OP_CLOSE:
        close(1000);
        return;
      case OP_BINARY:
        fail(1003, "Binary frames aren't supported");
        return;
      case OP_TEXT:
      case OP_CONT: {
        if (opcode === OP_TEXT && fragments.length) {
          fail(1002, "Unexpected new message");
          return;
        }
        if (opcode === OP_CONT && !fragments.length) {
          fail(1002, "Unexpected continuation");
          return;
        }
        fragmentBytes += payload.length;
        if (fragmentBytes > MAX_MESSAGE_BYTES) {
          fail(1009, "Message too large");
          return;
        }
        fragments.push(payload);
        if (fin) {
          const message = Buffer.concat(fragments).toString("utf8");
          fragments = [];
          fragmentBytes = 0;
          try {
            messageHandler(message);
          } catch (error) {
            console.error("WebSocket message handler failed", error);
          }
        }
        return;
      }
      default:
        fail(1002, "Unknown opcode");
    }
  };

  const parse = () => {
    while (!closed && buffer.length >= 2) {
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) {
          return;
        }
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) {
          return;
        }
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE_BYTES)) {
          fail(1009, "Message too large");
          return;
        }
        length = Number(big);
        offset = 10;
      }
      if (!masked) {
        // clients must mask every frame
        fail(1002, "Unmasked frame");
        return;
      }
      if (buffer.length < offset + 4 + length) {
        return;
      }
      const mask = buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(
        buffer.subarray(offset + 4, offset + 4 + length),
      );
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i & 3];
      }
      buffer = buffer.subarray(offset + 4 + length);
      handleFrame(fin, opcode, payload);
    }
  };

  socket.on("data", (chunk: Buffer) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    parse();
  });
  socket.on("close", finish);
  socket.on("error", finish);
  socket.on("end", finish);
  if (buffer.length) {
    parse();
  }

  return {
    send: (text) => write(OP_TEXT, Buffer.from(text, "utf8")),
    bufferedAmount: () => socket.writableLength,
    ping: () => {
      sawFrame = false;
      write(OP_PING, Buffer.alloc(0));
    },
    alive: () => sawFrame,
    close,
    onMessage: (handler) => {
      messageHandler = handler;
    },
    onClose: (handler) => {
      closeHandler = handler;
      if (closed) {
        handler();
      }
    },
  };
};
