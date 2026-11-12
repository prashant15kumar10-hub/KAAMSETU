# KAAMSETU — Run in Visual Studio Code (Windows)

This guide is for the combined frontend + backend project. The launcher resolves paths from its own location, so it avoids the common mistake of running commands from the wrong nested folder.

## 1. Install prerequisites

1. Install **Node.js 22.13 or newer** from https://nodejs.org/
2. Install **Visual Studio Code** from https://code.visualstudio.com/
3. Close and reopen VS Code after installing Node.js.
4. In VS Code, select **Terminal → New Terminal**, then check:

```powershell
node --version
npm --version
```

## 2. Open the correct project folder

1. Extract `KaamSetu-Combined.zip` completely.
2. In VS Code, choose **File → Open Folder...**
3. Select the folder named `KaamSetu-Combined` that contains all of these items directly:
   - `start-kaamsetu.ps1`
   - `run-tests.ps1`
   - `kaamsetu-backend`
   - `kaamsetu-frontend`
4. If extraction created two nested folders both named `KaamSetu-Combined`, open the **inner** one containing the scripts and the two project folders.

## 3. Run backend tests

From the project root in VS Code's PowerShell terminal:

```powershell
.\run-tests.ps1
```

Expected ending for this version: `# pass 59` and `# fail 0` (the exact count can change if tests are updated).

## 4. Start frontend + backend together (recommended)

From the project root in VS Code's PowerShell terminal:

```powershell
.\start-kaamsetu.ps1
```

The launcher:
- checks that the backend and frontend folders exist;
- checks that Node.js and npm are available;
- checks the Node.js version;
- checks whether the selected port already accepts connections;
- sets `STATIC_DIR` to the **absolute frontend path** (so startup doesn't depend on relative path assumptions);
- changes to the backend directory and runs `npm start`.

If PowerShell blocks the script because of the execution policy, use this command instead:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-kaamsetu.ps1
```

Wait for the `server_started` log line. The default address is:

http://127.0.0.1:3000/

**Keep this terminal open.** The backend runs in the foreground. If you close the terminal, press `Ctrl+C`, or the process exits, the browser will show `ERR_CONNECTION_REFUSED`.

## 5. Verify the application

Open these in Chrome while the server terminal is still running:

- App: http://127.0.0.1:3000/
- Health: http://127.0.0.1:3000/api/health
- Readiness: http://127.0.0.1:3000/api/ready
- Capabilities: http://127.0.0.1:3000/api/capabilities

In another VS Code terminal, you can also run:

```powershell
Test-NetConnection 127.0.0.1 -Port 3000
```

Expected: `TcpTestSucceeded : True`.

## 6. Troubleshooting

### Browser says `ERR_CONNECTION_REFUSED`

1. Look at the terminal where `npm start` or `.\start-kaamsetu.ps1` was run.
2. If you see a normal PowerShell prompt (`PS C:\...>`), the server is no longer running. Start it again.
3. If you see `server_started` but the browser still refuses, leave that terminal open and run this in a **second** terminal:

   ```powershell
   Test-NetConnection 127.0.0.1 -Port 3000
   ```

4. If `TcpTestSucceeded` is `False`, copy the complete server-terminal output and the connection-test output for diagnosis.
5. If port 3000 is already in use, use another port:

   ```powershell
   $env:PORT = "3001"
   .\start-kaamsetu.ps1
   ```

   Then open http://127.0.0.1:3001/. If using a different port, set `PORT` in the same terminal before starting the script.

### Frontend files missing or blank page

Use `.\start-kaamsetu.ps1` from the project root. It sets `STATIC_DIR` to the exact frontend folder. Do not open `index.html` directly from File Explorer; the frontend expects the backend API on the same origin.

### `node` or `npm` is not recognized

Install Node.js 22.13+ from https://nodejs.org/ and restart VS Code.

### Tests fail

Run `.\run-tests.ps1` from the project root, then share the complete test error output.

## 7. Optional development data

Only if you want sample data in your local development database, stop the server with `Ctrl+C`, then run:

```powershell
Push-Location .\kaamsetu-backend
npm run seed
Pop-Location
```

Start the app again with `.\start-kaamsetu.ps1`. See `kaamsetu-backend/README.md` for sample-account details. Use sample accounts only locally; do not use them in a public deployment.

## 8. Stop the app

In the terminal running the server, press `Ctrl+C`.

## Important limitations

The automated tests and local smoke checks are not a full manual test of every user journey or a production deployment. External services such as real-money payments, OTP, and SMS/WhatsApp notifications are not automatically configured. See `REPORT.md` and the backend docs before treating those features as live.
