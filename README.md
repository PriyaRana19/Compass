# Audio Compass Web App

A simple smartphone web app that emits sound when the current heading is off by 4 degrees or more from the target bearing.

## How to run

This app needs to be opened through a web server or HTTPS, not as a raw downloaded file, because the phone compass API requires a secure context.

### Option 1: Local server

1. Open a terminal in this folder.
2. Run `python3 serve.py`.
3. On your phone, open `http://YOUR_COMPUTER_IP:8000/`.
4. Tap `Enable orientation` and allow sensor access.
5. Point toward the desired direction.
6. Tap `Set target to current heading`.
7. Move the phone away from the target bearing. Sound will play when the error is between 0° and 4°.

### Option 2: GitHub Pages

1. Push this folder to GitHub.
2. Enable GitHub Pages for the repository.
3. Open the published URL on your phone.

## Notes

- Works best on modern mobile browsers with `deviceorientation` support.
- iOS Safari requires permission to access motion and orientation data.
- Sound is generated with the Web Audio API.
