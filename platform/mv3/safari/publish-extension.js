/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2025-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

import * as fs from 'node:fs/promises';
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/******************************************************************************/

function voidFunc() {
}

/******************************************************************************/

async function getSecrets() {
    const homeDir = os.homedir();
    let currentDir = process.cwd();
    let fileName = '';
    for (;;) {
        fileName = `${currentDir}/ubo_secrets`;
        const stat = await fs.stat(fileName).catch(voidFunc);
        if ( stat !== undefined ) { break; }
        currentDir = path.resolve(currentDir, '..');
        if ( currentDir.startsWith(homeDir) === false ) { return; }
    }
    console.log(`Found secrets in ${fileName}`);
    const text = await fs.readFile(fileName, { encoding: 'utf8' }).catch(voidFunc);
    const secrets = JSON.parse(text);
    return secrets;
}

/******************************************************************************/

async function getRepoRoot() {
    const homeDir = os.homedir();
    let currentDir = process.cwd();
    for (;;) {
        const fileName = `${currentDir}/.git`;
        const stat = await fs.stat(fileName).catch(voidFunc);
        if ( stat !== undefined ) { return currentDir; }
        currentDir = path.resolve(currentDir, '..');
        if ( currentDir.startsWith(homeDir) === false ) { return; }
    }
}

/******************************************************************************/

async function getReleaseInfo() {
    console.log(`Fetching release info for ${githubTag} from GitHub`);
    const releaseInfoUrl =  `https://api.github.com/repos/${githubOwner}/${githubRepo}/releases/tags/${githubTag}`;
    const request = new Request(releaseInfoUrl, {
        headers: {
            Authorization: githubAuth,
        },
    });
    const response = await fetch(request).catch(voidFunc);
    if ( response === undefined ) { return; }
    if ( response.ok !== true ) { return; }
    const releaseInfo = await response.json().catch(voidFunc);
    if ( releaseInfo === undefined ) { return; }
    return releaseInfo;
}

/******************************************************************************/

async function getAssetInfo(assetName) {
    const releaseInfo = await getReleaseInfo();
    if ( releaseInfo === undefined ) { return; }
    if ( releaseInfo.assets === undefined ) { return; }
    for ( const asset of releaseInfo.assets ) {
        if ( asset.name.includes(assetName) ) { return asset; }
    }
}

/******************************************************************************/

async function downloadAssetFromRelease(assetInfo) {
    const assetURL = assetInfo.url;
    console.log(`Fetching ${assetURL}`);
    const request = new Request(assetURL, {
        headers: {
            Authorization: secrets.githubAuth,
            Accept: 'application/octet-stream',
        },
    });
    const response = await fetch(request).catch(voidFunc);
    if ( response.ok !== true ) { return; }
    const data = await response.bytes().catch(voidFunc);
    if ( data === undefined ) { return; }
    const tempDir = await fs.mkdtemp('/tmp/github-asset-');
    const fileName = `${tempDir}/${assetInfo.name}`;
    await fs.writeFile(fileName, data);
    return fileName;
}

/******************************************************************************/

async function uploadAssetToRelease(assetPath, mimeType) {
    console.log(`Uploading "${assetPath}" to GitHub...`);
    const data = await fs.readFile(assetPath).catch(( ) => { });
    if ( data === undefined ) { return; }
    const releaseInfo = await getReleaseInfo();
    if ( releaseInfo.upload_url === undefined ) { return; }
    const assetName = path.basename(assetPath);
    const uploadURL = releaseInfo.upload_url.replace('{?name,label}', `?name=${assetName}`);
    console.log('Upload URL:', uploadURL);
    const request = new Request(uploadURL, {
        body: new Int8Array(data.buffer, data.byteOffset, data.length),
        headers: {
            Authorization: githubAuth,
            'Content-Type': mimeType,
        },
        method: 'POST',
    });
    const response = await fetch(request).catch(( ) => { });
    if ( response === undefined ) { return; }
    const json = await response.json();
    console.log(json);
    return json;
}

/******************************************************************************/

async function deleteAssetFromRelease(assetURL) {
    print(`Remove ${assetURL} from GitHub release ${githubTag}...`);
    const request = new Request(assetURL, {
        headers: {
            Authorization: githubAuth,
        },
        method: 'DELETE',
    });
    const response = await fetch(request);
    return response.ok;
}

/******************************************************************************/

async function getManifest(path) {
    const text = await fs.readFile(path, { encoding: 'utf8' });
    return JSON.parse(text);
}

/******************************************************************************/

// Project version is the number of 1-hour slices since first build

function patchProjectVersion(manifest, text) {
    const originDate = new Date('2022-09-06T17:47:52.000Z');
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.version);
    const monthday = parseInt(match[2]);
    const month = `${Math.floor(monthday / 100)}`.padStart(2, '0');
    const day = `${monthday % 100}`.padStart(2, '0');
    const dayminutes = parseInt(match[3]);
    const hours = `${Math.floor(dayminutes / 100)}`.padStart(2, '0');
    const minutes = `${dayminutes % 100}`.padStart(2, '0');
    const manifestDate = new Date(`${match[1]}-${month}-${day}T${hours}:${minutes}`)
    const unitsPerDay = 24 * 60 * 60 * 1000;
    const daysSinceOrigin = (manifestDate.getTime() - originDate.getTime()) / unitsPerDay;
    const major = Math.floor(daysSinceOrigin);
    const minor = match[3];
    return text.replaceAll(/\bCURRENT_PROJECT_VERSION = [^;]*;/g,
        `CURRENT_PROJECT_VERSION = ${major}.${minor};`
    );
}

function patchMarketingVersion(manifest, text) {
    return text.replaceAll(/\bMARKETING_VERSION = [^;]*;/g,
        `MARKETING_VERSION = ${manifest.version};`
    );
}

async function patchXcodeVersion(manifest, xcprojPath) {
    let text = await fs.readFile(xcprojPath, { encoding: 'utf8' });
    text = patchMarketingVersion(manifest, text);
    text = patchProjectVersion(manifest, text);
    await fs.writeFile(xcprojPath, text);
}

/******************************************************************************/

async function shellExec(text) {
    let command = '';
    for ( const line of text.split(/[\n\r]+/) ) {
        command += line.trimEnd();
        if ( command.endsWith('\\') ) {
            command = command.slice(0, -1);
            continue;
        }
        command = command.trim();
        if ( command === '' ) { continue; }
        execSync(command);
        command = '';
    }
}

/******************************************************************************/

const commandLineArgs = (( ) => {
    const args = Object.create(null);
    let name, value;
    for ( const arg of process.argv.slice(2) ) {
        const pos = arg.indexOf('=');
        if ( pos === -1 ) {
            name = arg;
            value = true;
        } else {
            name = arg.slice(0, pos);
            value = arg.slice(pos+1);
        }
        args[name] = value;
    }
    return args;
})();

/******************************************************************************/

const secrets = await getSecrets();
const githubOwner = commandLineArgs.ghowner || '';
const githubRepo = commandLineArgs.ghrepo || '';
const githubAuth = `Bearer ${secrets.github_token}`;
const githubTag = commandLineArgs.ghtag;
const localRepoRoot = await getRepoRoot() || '';

async function main() {
    if ( secrets === undefined ) { return 'Need secrets'; }
    if ( githubOwner === '' ) { return 'Need GitHub owner'; }
    if ( githubRepo === '' ) { return 'Need GitHub repo'; }
    if ( localRepoRoot === '' ) { return 'Need local repo root'; }
    if ( commandLineArgs.asset === undefined ) { return 'Need asset=[...]'; }

    const assetInfo = await getAssetInfo(commandLineArgs.asset);

    console.log(`GitHub owner: "${githubOwner}"`);
    console.log(`GitHub repo: "${githubRepo}"`);
    console.log(`Release tag: "${githubTag}"`);
    console.log(`Release asset: "${assetInfo.name}"`);
    console.log(`Local repo root: "${localRepoRoot}"`);

    // Fetch asset from GitHub repo
    const assetName = path.basename(assetInfo.name, path.extname(assetInfo.name));
    const filePath = await downloadAssetFromRelease(assetInfo);
    console.log('Asset saved at', filePath);
    const tempdirPath = path.dirname(filePath);
    await fs.mkdir(`${tempdirPath}/${assetName}`, { recursive: true });
    shellExec(`unzip "${filePath}" -d "${tempdirPath}/${assetName}"`);

    // Copy files to local build directory
    console.log(`Copy package files to "${localRepoRoot}/dist/build/uBOLite.safari"`);
    shellExec(`
        rm -rf "${localRepoRoot}/dist/build/uBOLite.safari"
        mkdir -p "${localRepoRoot}/dist/build/uBOLite.safari"
        cp -R "${tempdirPath}/${assetName}/"* "${localRepoRoot}/dist/build/uBOLite.safari/"
    `);

    const xcodeDir = `${localRepoRoot}/platform/mv3/safari/xcode`;
    const resourcesPath = `${xcodeDir}/Shared (Extension)/Resources`;

    // Patch extension to pass validation in Apple Store
    console.log('Patch extension to pass validation in Apple Store');
    shellExec(`node \\
        "${localRepoRoot}/platform/mv3/safari/patch-extension.js" \\
        packageDir="${localRepoRoot}/dist/build/uBOLite.safari"
    `);

    console.log('Read manifest', resourcesPath);
    const manifestPath = `${localRepoRoot}/dist/build/uBOLite.safari/manifest.json`;
    const manifest = await getManifest(manifestPath);

    // Patch xcode version, build number
    console.log('Patch xcode project with manifest version');
    const xcprojDir = `${xcodeDir}/uBlock Origin Lite.xcodeproj`;
    await patchXcodeVersion(manifest, `${xcprojDir}/project.pbxproj`);

    // xcodebuild ... archive
    const buildNamePrefix = `uBOLite_${manifest.version}`;

    // Build for iOS
    if ( commandLineArgs.ios ) {
        console.log(`Building archive ${buildNamePrefix}.ios`);
        shellExec(`xcodebuild clean archive \\
            -configuration release \\
            -destination 'generic/platform=iOS' \\
            -project "${xcprojDir}" \\
            -scheme "uBlock Origin Lite (iOS)" \\
        `);
        if ( commandLineArgs.publish === 'github' ) {
            console.log(`Building app from ${buildNamePrefix}.ios.xarchive`);
            shellExec(`xcodebuild -exportArchive \\
                -archivePath "${tempdirPath}/${buildNamePrefix}.ios.xcarchive" \\
                -exportPath "${tempdirPath}/${buildNamePrefix}.ios" \\
                -exportOptionsPlist "${xcodeDir}/exportOptionsAdHoc.ios.plist" \\
            `);
        }
    }

    // Build for MacOX
    if ( commandLineArgs.macos ) {
        console.log(`Building archive ${buildNamePrefix}.macos`);
        shellExec(`xcodebuild clean archive \\
            -configuration release \\
            -destination 'generic/platform=macOS' \\
            -project "${xcprojDir}" \\
            -scheme "uBlock Origin Lite (macOS)" \\
        `);
        //console.log(`Building app from ${buildNamePrefix}.macos.xarchive`);
        //shellExec(`xcodebuild -exportArchive \\
        //    -archivePath "${tempdirPath}/${buildNamePrefix}.macos.xcarchive" \\
        //    -exportPath "${tempdirPath}/${buildNamePrefix}.macos" \\
        //    -exportOptionsPlist "${xcodeDir}/exportOptionsAdHoc.macos.plist" \\
        //`);
        if ( commandLineArgs.publish === 'github' ) {
            shellExec(`cd "${tempdirPath}" && zip -r \\
                "${buildNamePrefix}.macos.zip" \\
                "${buildNamePrefix}.macos"/* \\
            `);
            await uploadAssetToRelease(`${tempdirPath}/${buildNamePrefix}.macos.zip`, 'application/zip');
            await deleteAssetFromRelease(assetInfo.url);
        }
    }

    // Clean up
    if ( commandLineArgs.nocleanup !== true ) {
        console.log(`Removing ${tempdirPath}`);
        shellExec(`rm -rf "${tempdirPath}"`);
    }

    console.log('Done');
}

main().then(result => {
    if ( result !== undefined ) {
        console.log(result);
        process.exit(1);
    }
    process.exit(0);
});
