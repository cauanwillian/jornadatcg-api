import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

@Injectable()
export class PasswordService {
  // Fixed, versioned parameters prevent untrusted stored values from escalating cost.
  private readonly prefix = 'scrypt$131072$8$1';

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await this.derive(password, salt);
    return `${this.prefix}$${salt.toString('hex')}$${key.toString('hex')}`;
  }

  async verify(password: string, stored: string | undefined): Promise<boolean> {
    const match = stored?.match(
      /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/,
    );
    // Unknown users and unsupported hashes still perform the same expensive operation.
    const salt = match ? Buffer.from(match[1], 'hex') : Buffer.alloc(16);
    const expected = match ? Buffer.from(match[2], 'hex') : Buffer.alloc(64);
    const actual = await this.derive(password, salt);
    const equal = timingSafeEqual(actual, expected);
    return !!match && equal;
  }

  private derive(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(
        password,
        salt,
        64,
        { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 },
        (error, key) => {
          if (error) reject(error);
          else resolve(key);
        },
      );
    });
  }
}
