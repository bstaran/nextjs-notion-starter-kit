import { getAllPagesInSpace, uuidToId, getPageProperty } from 'notion-utils'
import pMemoize from 'p-memoize'

import * as config from './config'
import * as types from './types'
import { includeNotionIdInUrls } from './config'
import { getCanonicalPageId } from './get-canonical-page-id'
import { notion } from './notion-api'

// URL에 UUID를 포함할지 여부를 설정
const uuid = !!includeNotionIdInUrls

// 사이트 맵을 가져오는 함수
export async function getSiteMap(): Promise<types.SiteMap> {
  // 모든 페이지를 가져옴
  const partialSiteMap = await getAllPages(
    config.rootNotionPageId,
    config.rootNotionSpaceId
  )

  // 사이트 정보와 페이지 맵을 결합하여 반환
  return {
    site: config.site,
    ...partialSiteMap
  } as types.SiteMap
}

// getAllPagesImpl 함수를 메모이제이션하여 캐싱
const getAllPages = pMemoize(getAllPagesImpl, {
  cacheKey: (...args) => JSON.stringify(args)
})

// 모든 페이지를 가져오는 구현 함수
async function getAllPagesImpl(
  rootNotionPageId: string,
  rootNotionSpaceId: string
): Promise<Partial<types.SiteMap>> {
  // 페이지를 가져오는 함수
  const getPage = async (pageId: string, ...args) => {
    console.log('\nnotion getPage', uuidToId(pageId))
    return notion.getPage(pageId, ...args)
  }

  // 주어진 공간 내의 모든 페이지를 가져옴
  const pageMap = await getAllPagesInSpace(
    rootNotionPageId,
    rootNotionSpaceId,
    getPage
  )

  // 페이지 맵을 순회하며 canonicalPageMap을 생성
  const canonicalPageMap = Object.keys(pageMap).reduce(
    (map, pageId: string) => {
      const recordMap = pageMap[pageId]
      if (!recordMap) {
        throw new Error(`Error loading page "${pageId}"`)
      }

      // 페이지의 'Public' 속성을 확인
      const block = recordMap.block[pageId]?.value
      if (!(getPageProperty<boolean|null>('Public', block, recordMap) ?? true)) {
        return map
      }

      // canonicalPageId를 생성
      const canonicalPageId = getCanonicalPageId(pageId, recordMap, {
        uuid
      })

      // 중복된 canonicalPageId가 있는지 확인
      if (map[canonicalPageId]) {
        console.warn('error duplicate canonical page id', {
          canonicalPageId,
          pageId,
          existingPageId: map[canonicalPageId]
        })

        return map
      } else {
        return {
          ...map,
          [canonicalPageId]: pageId
        }
      }
    },
    {}
  )

  // 페이지 맵과 canonicalPageMap을 반환
  return {
    pageMap,
    canonicalPageMap
  }
}