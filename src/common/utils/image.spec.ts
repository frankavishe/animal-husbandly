import { detectImageType } from './image';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 '),
]);

describe('detectImageType', () => {
  it('detects PNG', () => expect(detectImageType(png)).toEqual({ mime: 'image/png', ext: 'png' }));
  it('detects JPEG', () =>
    expect(detectImageType(jpeg)).toEqual({ mime: 'image/jpeg', ext: 'jpg' }));
  it('detects WebP', () =>
    expect(detectImageType(webp)).toEqual({ mime: 'image/webp', ext: 'webp' }));

  it('rejects a text file', () => expect(detectImageType(Buffer.from('hello world'))).toBeNull());
  it('rejects a GIF', () => expect(detectImageType(Buffer.from('GIF89a......'))).toBeNull());
  it('rejects an empty buffer', () => expect(detectImageType(Buffer.alloc(0))).toBeNull());
  it('rejects a truncated RIFF header', () =>
    expect(detectImageType(Buffer.from('RIFF1234'))).toBeNull());
  it('rejects a RIFF that is not WebP (e.g. WAV)', () =>
    expect(detectImageType(Buffer.from('RIFF1234WAVEfmt '))).toBeNull());
});
