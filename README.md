# HMT Code AI

Windows desktop coding assistant using xKiro's OpenAI-compatible API. The Windows app uses the supplied logo as its executable/installer icon and in the welcome screen. Enter the xKiro key in **Settings → xKiro API key**; Electron encrypts it with Windows account storage (`safeStorage`) instead of writing it to browser local storage. A server environment variable `XKIRO_API_KEY` remains available as an optional fallback. Set `XKIRO_BASE_URL` to override the default `https://api.xkiro.com/v1`.

Chat history and app settings are stored in `%APPDATA%\HMT Code AI\app-data.json`, independently of the temporary local HTTP port, and restored at launch. The app can migrate history still available in the current browser origin on first launch. Earlier history saved under previous random-port origins may not be recoverable automatically. This is prompt and app configuration, not model-weight training; HMT Code AI identifies itself as HMT Code AI and only lists free xKiro chat models in the selector.

The chat supports image attachments (PNG, JPEG, GIF, WebP) and text/source files (including JS/TS, Python, C/C++, Java, Go, Rust, SQL, JSON, YAML, Markdown, and text). Files are capped at 2 MB each and 4 MB total per message. Images require a free model marked **Vision**. xKiro accepts OpenAI-compatible image `content` parts and base64 data URLs ([Vision guide](https://docs.xkiro.com/guides/vision/)). User messages can be edited, copied, or deleted; AI replies can be copied or regenerated.

Generated files can be created only inside a folder explicitly selected in **Settings → Workspace files**. Replacing existing files and deleting a file require confirmation. Deletion accepts a workspace-relative path and cannot target folders or paths outside the selected workspace.

The model selector loads the current xKiro catalog at runtime and defaults to a model tagged `access_tier: free` (preferring a coder-named model if listed). The catalog may contain paid models too; they are labeled with their reported tier and can be selected manually. xKiro does not filter the catalog by account entitlement, so a free-tier tag does not guarantee remaining quota or account eligibility.

## Build the Windows installer

Requires Node.js 20+ and Windows.

```powershell
npm install
npm run dist
```

For a local build, copy `xkiro-secret.example.cjs` to `xkiro-secret.local.cjs` and paste the fallback key into its `apiKey` value. The local file is git-ignored, but it is included in a local build when present. For GitHub builds, add an Actions repository secret named `XKIRO_API_KEY`; the workflow creates the ignored file from that secret before packaging. In the app, a key saved in **Settings → xKiro API key** takes priority over the built-in fallback. Removing the Settings key reverts to the fallback. The Settings key is encrypted for that Windows account. A key embedded in an installer can be extracted by anyone who receives it; use a dedicated, quota-limited key for a public release and rotate any key that has been exposed.

The installer is written to `outputs/HMT Code AI Setup <version>.exe`. The packaged app has explicit entries for the Electron main process, preload, CommonJS API bridge, and `public/**/*` assets. The main process resolves app files from `app.getAppPath()` and the server resolves static assets from its own `__dirname`, so neither depends on the launcher's current directory. Native `.node` modules are configured to unpack from `app.asar`.

## GitHub automatic updates

The app uses `electron-updater` with a private GitHub Releases feed and the NSIS installer target. Each push to the `main` branch starts `.github/workflows/publish-windows.yml`; GitHub Actions builds a new Windows installer, assigns a unique increasing release version, and publishes the installer plus `latest.yml` to a private GitHub Release. The installed app checks for updates at launch after a read-only GitHub token has been saved in **Settings → Application updates**. **Check Update** checks immediately. An in-app Liquid Glass notice offers Download, then Restart & install. A source edit reaches users after it is committed and pushed to `main` and the workflow finishes successfully; an unpushed local edit cannot trigger GitHub.

To connect your source to GitHub:

1. On the page in your screenshot, leave **Private** selected, leave **Add README** off, leave **Add .gitignore** as **No .gitignore**, and click **Create repository**. The project already has its own `.gitignore`.
2. In the new repository, open **Settings → Secrets and variables → Actions → New repository secret**. Name it `XKIRO_API_KEY`, paste your fallback xKiro key as the value, then save. The release workflow needs this secret to put the fallback key into each installer.
3. In PowerShell, go to this project folder and push it to your new repository. Replace `<username>` and `<repo>` with your GitHub account and repository name:

```powershell
Set-Location 'D:\Tệp Minh Trí\code\HMT Coder AI'
git init
git add .
git commit -m "Initial HMT Code AI source"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

4. Keep the default branch named `main`. The included `.gitignore` excludes `xkiro-secret.local.cjs`, `.env`, `node_modules`, and build output. Run `git status` before committing and check that the local key file is not listed.
5. Open the repository's **Actions** tab and wait for **Build and publish Windows updates** to finish. The workflow creates a private release and publishes the installer and update metadata on each push to `main`.
6. To authorize the installed app to read those private releases, open GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. Limit it to this one repository and set **Contents: Read-only**, then generate and copy the token.
7. Download and install the `.exe` from the first private GitHub Release. In the app, open **Settings → Application updates**, paste the fine-grained token, and save it. The app encrypts the token for your Windows account. Future launches can check for updates; **Check Update** checks immediately, and the notice offers Download then Restart & install.

For source edits, use commit → push; GitHub does not detect unsaved local file changes. Do not add either token or API key to source control. The xKiro fallback goes in the repository Actions secret; the read-only GitHub token goes only in the installed app's Settings. Anyone with an installer can extract its embedded xKiro key, so restrict release access and use a key with limited quota.

## Startup diagnostics

Fatal main-process, startup, load, renderer, and unhandled-promise errors show a Windows dialog containing the stack trace and are also written to:

```text
%APPDATA%\HMT Code AI\logs\main.log
%APPDATA%\HMT Code AI\logs\chromium.log
```

To locate the installed executable in PowerShell:

```powershell
$app = Get-ChildItem "$env:LOCALAPPDATA\Programs" -Filter "HMT Code AI.exe" -Recurse | Select-Object -First 1 -ExpandProperty FullName
$app
```

Launch it with Chromium logging enabled and redirect any inherited console streams:

```powershell
& $app --enable-logging=file --log-file="$env:TEMP\hmt-code-ai-chromium.log" 1>"$env:TEMP\hmt-code-ai-stdout.log" 2>"$env:TEMP\hmt-code-ai-stderr.log"
```

Windows GUI executables may not attach to the invoking console, so the redirected stream files can be empty. The app's log files above are the reliable diagnostics. Read them with:

```powershell
Get-Content "$env:APPDATA\HMT Code AI\logs\main.log" -Tail 200
Get-Content "$env:APPDATA\HMT Code AI\logs\chromium.log" -Tail 200
```

In Command Prompt, the default per-user installer path can be launched and logs displayed as follows:

```bat
"%LOCALAPPDATA%\Programs\HMT Code AI\HMT Code AI.exe" --enable-logging=file --log-file="%TEMP%\hmt-code-ai-chromium.log" 1>"%TEMP%\hmt-code-ai-stdout.log" 2>"%TEMP%\hmt-code-ai-stderr.log"
type "%APPDATA%\HMT Code AI\logs\main.log"
type "%APPDATA%\HMT Code AI\logs\chromium.log"
```




