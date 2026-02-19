import { connect } from 'cloudflare:sockets';

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

/**
 * Minimaler SMTP-Client für Cloudflare Workers.
 * Unterstützt STARTTLS (Port 587) und implizites TLS (Port 465).
 */
export class SmtpClient {
  private writer!: WritableStreamDefaultWriter<Uint8Array>;
  private reader!: ReadableStreamDefaultReader<Uint8Array>;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private buffer = '';

  async connect(config: SmtpConfig): Promise<void> {
    const implicitTls = config.port === 465;

    let socket = connect(
      { hostname: config.host, port: config.port },
      { secureTransport: implicitTls ? 'on' : 'starttls', allowHalfOpen: false },
    );

    this.writer = socket.writable.getWriter();
    this.reader = socket.readable.getReader();

    // Greeting lesen
    await this.readResponse(220);

    // EHLO
    await this.sendCommand('EHLO worker.cloudflare.com', 250);

    // STARTTLS (nur bei Port 587 o.ä.)
    if (!implicitTls) {
      await this.sendCommand('STARTTLS', 220);

      // TLS-Upgrade
      this.writer.releaseLock();
      this.reader.releaseLock();
      socket = socket.startTls();
      this.writer = socket.writable.getWriter();
      this.reader = socket.readable.getReader();
      this.buffer = '';

      // Nach TLS erneut EHLO
      await this.sendCommand('EHLO worker.cloudflare.com', 250);
    }

    // AUTH LOGIN
    await this.sendCommand('AUTH LOGIN', 334);
    await this.sendCommand(btoa(config.username), 334);
    await this.sendCommand(btoa(config.password), 235);
  }

  async sendMail(
    from: string,
    to: string[],
    message: string,
  ): Promise<void> {
    await this.sendCommand(`MAIL FROM:<${from}>`, 250);

    for (const addr of to) {
      await this.sendCommand(`RCPT TO:<${addr}>`, 250);
    }

    await this.sendCommand('DATA', 354);

    // Dot-Stuffing (RFC 5321 §4.5.2): Zeilen die mit "." beginnen
    // werden mit einem extra "." geprefixed.
    const stuffed = message.replace(/\r\n\./g, '\r\n..');
    await this.write(stuffed + '\r\n.\r\n');
    await this.readResponse(250);
  }

  async quit(): Promise<void> {
    try {
      await this.sendCommand('QUIT', 221);
    } catch {
      // Verbindung kann schon geschlossen sein
    }
  }

  private async sendCommand(
    cmd: string,
    expectedCode: number,
  ): Promise<string> {
    await this.write(cmd + '\r\n');
    return this.readResponse(expectedCode);
  }

  private async write(data: string): Promise<void> {
    await this.writer.write(this.encoder.encode(data));
  }

  private async readResponse(expectedCode: number): Promise<string> {
    let response = '';

    while (true) {
      const line = await this.readLine();
      response += line + '\n';

      // Letzte Zeile einer SMTP-Antwort: "250 OK" (Leerzeichen nach Code)
      // Fortsetzungszeilen: "250-..." (Bindestrich nach Code)
      if (line.length >= 4 && line[3] === ' ') {
        const code = parseInt(line.substring(0, 3), 10);
        if (code !== expectedCode) {
          throw new Error(
            `SMTP-Fehler: erwartet ${expectedCode}, erhalten: ${line}`,
          );
        }
        return response;
      }
    }
  }

  private async readLine(): Promise<string> {
    while (true) {
      const idx = this.buffer.indexOf('\r\n');
      if (idx !== -1) {
        const line = this.buffer.substring(0, idx);
        this.buffer = this.buffer.substring(idx + 2);
        return line;
      }

      const { value, done } = await this.reader.read();
      if (done) {
        throw new Error('SMTP-Verbindung unerwartet geschlossen');
      }
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }
}
