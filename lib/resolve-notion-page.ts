import { ExtendedRecordMap } from 'notion-types'
import { parsePageId } from 'notion-utils'

import * as acl from './acl'
import { environment, pageUrlAdditions, pageUrlOverrides, site } from './config'
import { db } from './db'
import { getSiteMap } from './get-site-map'
import { getPage } from './notion'

export async function resolveNotionPage(domain: string, rawPageId?: string) {
  let pageId: string
  let recordMap: ExtendedRecordMap

  if (rawPageId && rawPageId !== 'index') {
    /**
     * 페이지 ID를 파싱하고, 오버라이드를 적용
     * parsePageId() : 주어진 페이지 ID 문자열을 Notion 페이지 ID로 변환
     */
    pageId = parsePageId(rawPageId)

    // 페이지 ID를 파싱하지 못한 경우, 오버라이드를 적용
    if (!pageId) {
      /**
       * pageUrlOverrides : rawPageId에 대한 오버라이드 맵핑
       * pageUrlAdditions : rawPageId에 대한 추가 맵핑
       */
      const override = pageUrlOverrides[rawPageId] || pageUrlAdditions[rawPageId]
      if (override) {
        pageId = parsePageId(override)
      }
    }

    /**
     * useUriToPageIdCache : 캐시된 데이터를 사용할지 여부
     * cacheKey : 캐시 키
     * cacheTTL : 캐시 유효 기간
     */
    const useUriToPageIdCache = true
    const cacheKey = `uri-to-page-id:${domain}:${environment}:${rawPageId}`
    // should we use a TTL for these mappings or make them permanent?
    // const cacheTTL = 8.64e7 // one day in milliseconds
    const cacheTTL = 3600000 * 24 * 30 // 1시간

    /**
     * 매칭된 pageUrlOverrides 또는 pageUrlAdditions가 없는 경우, 캐시된 데이를 사용할지 여부를 확인
     * 캐시된 데이터가 있으면 캐시된 데이터를 사용
     */
    if (!pageId && useUriToPageIdCache) {
      try {
        pageId = await db.get(cacheKey)
      } catch (err) {
        console.warn(`redis error get "${cacheKey}"`, err.message)
      }
    }

    /**
     * (pageUrlOverrides 또는 pageUrlAdditions가 있는 경우) 또는 (캐시된 데이터가 있는 경우)
     * 페이지 데이터를 가져옴
     */
    if (pageId) {
      recordMap = await getPage(pageId)
    } else {
      /**
       * getSiteMap() : 사이트 맵을 가져옴
       * canonicalPageMap : 사이트 맵에서 페이지 ID를 찾기 위한 맵
       */
      const siteMap = await getSiteMap()
      pageId = siteMap?.canonicalPageMap[rawPageId]
      if (pageId) {
        recordMap = await getPage(pageId)
        if (useUriToPageIdCache) {
          try {
            await db.set(cacheKey, pageId, cacheTTL)
          } catch (err) {
            console.warn(`redis error set "${cacheKey}"`, err.message)
          }
        }
      } else {
        return {
          error: {
            message: `Not found "${rawPageId}"`,
            statusCode: 404
          }
        }
      }
    }
  } else {
    pageId = site.rootNotionPageId
    recordMap = await getPage(pageId)
  }

  const props = { site, recordMap, pageId }
  // acl.pageAcl() : 페이지에 대한 액세스 제어 리스트를 가져옴
  return { ...props, ...(await acl.pageAcl(props)) }
}