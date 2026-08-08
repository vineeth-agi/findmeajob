import assert from 'node:assert/strict'
import test from 'node:test'
import { serializeJsonLd } from '../src/shared/seo.js'

test('JSON-LD serialization cannot be broken out of its script element', () => {
  const serialized = serializeJsonLd({ description: '</script><script>alert(1)</script>&\u2028' })
  assert.equal(serialized.includes('</script>'), false)
  assert.equal(serialized.includes('<script>'), false)
  assert.match(serialized, /\\u003c\/script\\u003e/)
  assert.match(serialized, /\\u0026/)
  assert.match(serialized, /\\u2028/)
})
