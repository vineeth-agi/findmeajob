export const SITE_ORIGIN = 'https://findmeajob.dev'
export const SOCIAL_IMAGE_URL = `${SITE_ORIGIN}/og.png`
export const SOCIAL_IMAGE_ALT = 'Findmeajob — discover official tech and software engineering roles'

/** Prevent untrusted catalog text from closing an inline JSON-LD script. */
export const serializeJsonLd = (value: unknown) => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029')

/** Shared by the root and dynamic job heads so every social preview uses one image. */
export const SOCIAL_IMAGE_META = [
  { property: 'og:image', content: SOCIAL_IMAGE_URL },
  { property: 'og:image:secure_url', content: SOCIAL_IMAGE_URL },
  { property: 'og:image:type', content: 'image/png' },
  { property: 'og:image:width', content: '1008' },
  { property: 'og:image:height', content: '522' },
  { property: 'og:image:alt', content: SOCIAL_IMAGE_ALT },
  { name: 'twitter:card', content: 'summary_large_image' },
  { name: 'twitter:image', content: SOCIAL_IMAGE_URL },
  { name: 'twitter:image:alt', content: SOCIAL_IMAGE_ALT },
] as const
