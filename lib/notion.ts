import { ExtendedRecordMap, SearchParams, SearchResults, CollectionViewBlock } from 'notion-types'
import { mergeRecordMaps } from 'notion-utils'
import { environment } from './config'
import { db } from './db'
import pMap from 'p-map'
import pMemoize from 'p-memoize'

import {
  isPreviewImageSupportEnabled,
  navigationLinks,
  navigationStyle
} from './config'
import { notion } from './notion-api'
import { getPreviewImageMap } from './preview-images'

const getNavigationLinkPages = pMemoize(
  async (): Promise<ExtendedRecordMap[]> => {
    const navigationLinkPageIds = (navigationLinks || [])
      .map((link) => link.pageId)
      .filter(Boolean)

    if (navigationStyle !== 'default' && navigationLinkPageIds.length) {
      return pMap(
        navigationLinkPageIds,
        async (navigationLinkPageId) =>
          notion.getPage(navigationLinkPageId, {
            chunkLimit: 1,
            fetchMissingBlocks: false,
            fetchCollections: false,
            signFileUrls: false
          }),
        {
          concurrency: 4
        }
      )
    }

    return []
  }
)

export async function getPage(pageId: string): Promise<ExtendedRecordMap> {
  let recordMap = await notion.getPage(pageId)

  if (navigationStyle !== 'default') {
    // ensure that any pages linked to in the custom navigation header have
    // their block info fully resolved in the page record map so we know
    // the page title, slug, etc.
    const navigationLinkRecordMaps = await getNavigationLinkPages()

    if (navigationLinkRecordMaps?.length) {
      recordMap = navigationLinkRecordMaps.reduce(
        (map, navigationLinkRecordMap) =>
          mergeRecordMaps(map, navigationLinkRecordMap),
        recordMap
      )
    }
  }

  if (isPreviewImageSupportEnabled) {
    const previewImageMap = await getPreviewImageMap(recordMap)
    ;(recordMap as any).preview_images = previewImageMap
  }

  return recordMap
}

export async function search(params: SearchParams): Promise<SearchResults> {
  return notion.search(params)
}

export async function getRootDatabase(domain: string, rootPageId: string): Promise<ExtendedRecordMap> {
  const recordMap = await notion.getPage(rootPageId);
  const databaseBlockEntry = Object.values(recordMap.block).find(
    (block) => block.value.type === 'collection_view'
  );

  if (!databaseBlockEntry) {
    throw new Error('No database found on the root page');
  }

  const databaseBlock = databaseBlockEntry.value as CollectionViewBlock;
  const collectionId = databaseBlock.id;
  const collectionViewId = databaseBlock.view_ids[0];
  const collectionData = await notion.getCollectionData(
    collectionId,
    collectionViewId,
    {
      'gallery_view': true,
    }
  );

  // ExtendedRecordMap type conversion
  const extendedRecordMap: ExtendedRecordMap = {
    block: recordMap.block,
    collection: collectionData.recordMap.collection,
    collection_view: collectionData.recordMap.collection_view,
    notion_user: recordMap.notion_user,
    collection_query: recordMap.collection_query,
    signed_urls: recordMap.signed_urls,
  };

  return extendedRecordMap;
}