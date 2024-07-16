import * as fs from 'fs'
import * as core from '@actions/core'
import axios, { ResponseType } from 'axios'

type FileMetadata = {
  name: string, 
  id: string
}

function parseDriveIdFromURL(isFile: boolean, path?: string) : string | undefined {
  if (!path) {
    return undefined
  }

  // Ensure the file path matches a Google Drive path
  const prefix = isFile ? '/file/d/' : '/drive/folders/'
  const suffix = isFile ? '/view' : ''

  const urlPath = new URL(path).pathname
  if (!urlPath.startsWith(prefix) || !urlPath.endsWith(suffix)) {
    core.error(`file-url path seems ill-formed: ${path})`)
    return undefined
  }

  // Strip the prefix/suffix to get the Drive id
  const driveId = urlPath.slice(prefix.length, -suffix.length)
  return driveId
}

function getGoogleDriveUrl(driveId: string | undefined = undefined): string {
  return `https://www.googleapis.com/drive/v3/files/${driveId ?? ""}`
}

async function run() : Promise<void> {

  core.saveState('isPost', true)

  const token = core.getInput('token')
  if (!token) {
    core.setFailed('No access token provided to action')
    return
  }

  const fileId = core.getInput('file-id')
  const fileUrl = core.getInput('file-url')
  const folderId = core.getInput('folder-id')
  const folderUrl = core.getInput('folder-url')

  if (!fileId && !fileUrl && !folderId && !folderUrl) {
    // If none of them are defined, error out
    core.setFailed('You must define one of following four inputs: fileId, fileUrl, folderId, folderUrl')
    return
  }

  const path = core.getInput('path')
  if (!path) {
    core.setFailed('No path provided to action')
    return
  }

  const isFile = fileId || fileUrl
  const fileIds: FileMetadata[] = []

  if (isFile) {
    // If we are downloading a file, parse the Id and add it to the array 
    const finalFileId = fileId ?? parseDriveIdFromURL(true, fileUrl)
    if (!finalFileId) {
      core.setFailed('Unknown file id')
      return
    }
    core.info(`Downloading file with Id ${fileId}`)
    fileIds.push({name: path, id: finalFileId})
  } else {
    // If we are downloading a folder, parse the folder Id
    const finalFolderId = folderId ?? parseDriveIdFromURL(false, folderUrl)
    if (!finalFolderId) {
      core.setFailed('Action could not determine folder id')
      return
    }
    // Query Google Drive to get the list of files in the folder
    const url = getGoogleDriveUrl()

    const options = {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        q: `'${finalFolderId}' in parents`,
        supportsAllDrives: true,
        pageSize: 1000
      },
    }

    core.info(`Searching folder with Id ${finalFolderId}`)
    const response = await axios.get(url, options)
    if (response.status != 200) {
      core.setFailed(`Failed to list files in folder from Google drive: ${response.status}`)
      return
    }

    // Add the file Ids to the array of files to download
    response.data.files.forEach(file => {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        core.warning(`Folder with name ${file.name} found, skipping as nested folders are not supported`)
        return
      }
      core.info(`Adding file ${file.name} to list of files to download`)
      fileIds.push({name: file.name, id: file.id})
    });
  }

  if (fileIds.length === 0) {
    core.setFailed("Failed to find any files to download")
  } else if (fileIds.length === 1) {
    // Only 1 file to download
    await downloadFile(token, fileIds[0])
  } else {
    // Create a folder at the path given 
    fs.mkdirSync(path)
    fileIds.forEach(async fileId => await downloadFile(token, fileId))
  }
}

async function downloadFile(token: string, file: FileMetadata) {
  // Query Google Drive
  const url = getGoogleDriveUrl(file.id)

  const options = {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/octet-stream',
    },
    params: {
      alt: 'media',
      supportsAllDrives: true,
    },
    responseType: 'stream' as ResponseType,
  }

  const response = await axios.get(url, options)
  if (response.status != 200) {
    core.setFailed(`Failed to get file from Google drive: ${response.status}`)
    return
  }
  
  // Write file out
  core.saveState('path', file.name)

  const downloadedFile = fs.createWriteStream(file.name)
  response.data.pipe(downloadedFile)
}

async function post() : Promise<void> {

  // Remove the downloaded file
  // const path = core.getState('path')
  // if (path && fs.existsSync(path)) {
  //   fs.rmSync(path)
  //   console.log(`Removed downloaded file ${path}`)
  // }
}

if (!core.getState('isPost')) {
  run()
} else {
  post()
}
