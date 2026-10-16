declare module 'curl-to-postmanv2' {
  interface ConvertResult {
    result: boolean
    reason?: string
    output?: Array<{ type: string; data: Record<string, unknown> & { name?: unknown; description?: unknown } }>
  }
  const converter: {
    convert(input: { type: 'string'; data: string }, cb: (err: Error | null, result: ConvertResult | undefined) => void): void
  }
  export default converter
}

/** Convertisseurs Apache-2.0 publiés par Postman : API commune `validate` / `convert`. */
interface PostmanConverterResult {
  result: boolean
  reason?: string
  output?: Array<{ type: string; data: Record<string, unknown> }>
}
interface PostmanConverter {
  validate(input: { type: 'string'; data: string }): { result: boolean; reason?: string; specificationVersion?: string }
  convert(input: { type: 'string'; data: string }, options: Record<string, unknown>, cb: (err: Error | null, res: PostmanConverterResult) => void): void
}
declare module 'openapi-to-postmanv2' {
  const converter: PostmanConverter
  export default converter
}
declare module 'raml-to-postman' {
  const converter: PostmanConverter
  export default converter
}
declare module 'raml1-to-postman' {
  const converter: PostmanConverter
  export default converter
}
declare module 'graphql-to-postman' {
  const converter: PostmanConverter
  export default converter
}
declare module 'swagger1-to-postman' {
  const converter: PostmanConverter
  export default converter
}
declare module 'postman-collection-transformer' {
  const transformer: {
    convert(collection: unknown, options: { inputVersion: string; outputVersion: string; retainIds?: boolean }, cb: (err: Error | null, result: Record<string, unknown>) => void): void
  }
  export default transformer
}
declare module 'postman-code-generators' {
  interface LanguageVariant {
    key: string
  }
  interface Language {
    key: string
    label: string
    syntax_mode: string
    variants: LanguageVariant[]
  }
  interface CodegenOption {
    id: string
    name: string
    type: 'boolean' | 'positiveInteger' | 'enum' | 'string'
    default: unknown
    availableOptions?: unknown[]
    description: string
  }
  const codegen: {
    getLanguageList(): Language[]
    getOptions(language: string, variant: string, cb: (err: Error | null, options: CodegenOption[]) => void): void
    convert(language: string, variant: string, request: unknown, options: Record<string, unknown>, cb: (err: Error | null, snippet: string) => void): void
  }
  export default codegen
}
declare module 'postman-collection' {
  const sdk: { Request: new (definition: unknown) => unknown }
  export default sdk
}
