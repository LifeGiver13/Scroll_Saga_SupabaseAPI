declare module "streamifier" {
    import { Readable } from "stream";

    interface Streamifier {
        createReadStream(buffer: Buffer | string): Readable;
    }

    const streamifier: Streamifier;

    // Under NodeNext + verbatimModuleSyntax, this is the safest 
    // way to typing a CommonJS module meant to be imported as default
    export default streamifier;
}