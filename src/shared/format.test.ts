import { describe, expect, it } from 'vitest'
import { formatCode, indentJson, isFormatLanguage } from './format'

describe('mise en forme (Prettier)', () => {
  it('déplie les objets JSON, garde les tableaux courts sur une ligne et les nombres intacts', async () => {
    const r = await formatCode('{"a":1,"b":{"c":2},"arr":[1,2,3],"o":[{"x":1}],"e":{},"big":12345678901234567890}', 'json')
    expect(r).toEqual({
      ok: true,
      code: '{\n  "a": 1,\n  "b": {\n    "c": 2\n  },\n  "arr": [1, 2, 3],\n  "o": [\n    {\n      "x": 1\n    }\n  ],\n  "e": {},\n  "big": 12345678901234567890\n}'
    })
  })

  it('conserve les {{variables}} en JSON, dans les chaînes comme en valeur nue', async () => {
    const r = await formatCode('{"id":{{userId}},"name":"{{name}}","{{key}}":true,"tags":[{{a}},{{b}}]}', 'json')
    expect(r).toEqual({ ok: true, code: '{\n  "id": {{userId}},\n  "name": "{{name}}",\n  "{{key}}": true,\n  "tags": [{{a}}, {{b}}]\n}' })
  })

  it('garde les commentaires JSON et signale une erreur à la bonne position', async () => {
    expect(await formatCode('{"a":1, // note\n"b":2}', 'json')).toEqual({ ok: true, code: '{\n  "a": 1, // note\n  "b": 2\n}' })
    const bad = await formatCode('{\n"a": 1,\n"b": }', 'json')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.message).toContain('(3:')
  })

  it('indente le XML et le HTML en conservant les variables', async () => {
    expect(await formatCode('<root><a x="{{v}}">t</a><b><c>{{id}}</c></b></root>', 'xml')).toEqual({
      ok: true,
      code: '<root>\n  <a x="{{v}}">t</a>\n  <b>\n    <c>{{id}}</c>\n  </b>\n</root>'
    })
    const html = await formatCode('<html><body><div><p>Bonjour {{name}}</p></div></body></html>', 'html')
    expect(html.ok && html.code).toContain('<p>Bonjour {{name}}</p>')
  })

  it('met en forme un script et refuse un code invalide sans exception', async () => {
    expect(await formatCode('pm.test("ok",function(){pm.expect(1).to.eql(1)})', 'javascript')).toEqual({
      ok: true,
      code: 'pm.test("ok", function () {\n  pm.expect(1).to.eql(1);\n});'
    })
    expect((await formatCode('<root><a>', 'xml')).ok).toBe(false)
    expect(await formatCode('   ', 'json')).toEqual({ ok: true, code: '   ' })
    expect(isFormatLanguage('xml')).toBe(true)
    expect(isFormatLanguage('text')).toBe(false)
  })
})

describe('réindentation des réponses JSON', () => {
  it('réindente sans perdre la précision des grands entiers', () => {
    expect(indentJson('{"id":12345678901234567890,"a":[1,{"b":"x , : { ]"}],"e":{},"f":[ ]}')).toBe(
      '{\n  "id": 12345678901234567890,\n  "a": [\n    1,\n    {\n      "b": "x , : { ]"\n    }\n  ],\n  "e": {},\n  "f": []\n}'
    )
    expect(indentJson('"texte \\" échappé"')).toBe('"texte \\" échappé"')
    expect(indentJson('{"a":')).toBeNull()
  })
})
