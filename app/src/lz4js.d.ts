declare module "lz4js" {
  const lz4: { decompress(src: Uint8Array, maxSize?: number): Uint8Array };
  export default lz4;
}
