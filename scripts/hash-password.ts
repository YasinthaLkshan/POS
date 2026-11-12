import { stdin, stdout } from 'node:process';
import { hashPassword } from '../apps/api/src/services/passwords';

if (!stdin.isTTY || !stdin.setRawMode)
  throw new Error('Run this command in an interactive Windows CMD or PowerShell terminal');
stdout.write('New password (input hidden): ');
const password = await new Promise<string>((resolve, reject) => {
  let value = '';
  const done = (error?: Error) => {
    stdin.off('data', onData);
    stdin.setRawMode(false);
    stdin.pause();
    stdout.write('\n');
    if (error) reject(error);
    else resolve(value);
  };
  const onData = (bytes: Buffer) => {
    for (const input of bytes.toString('utf8')) {
      if (input === '\r' || input === '\n') return done();
      if (input === '\u0003') return done(new Error('Cancelled'));
      if (input === '\u007f' || input === '\b') value = value.slice(0, -1);
      else if (input.charCodeAt(0) >= 32) value += input;
    }
  };
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', onData);
});
if (password.length < 12 || password.length > 256)
  throw new Error('Use a password of 12 to 256 characters');
stdout.write(`${await hashPassword(password)}\n`);
