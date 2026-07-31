# Audio Compass Web App

A simple smartphone web app that emits sound when the current heading is off by 4 degrees or more from the target bearing.

## How to run

1. Open `index.html` in a mobile browser.
2. Tap `Enable orientation` and allow sensor access.
3. Point toward the desired direction.
4. Tap `Set target to current heading`.
5. Move the phone away from the target bearing. Sound will play when the error reaches 4° or more.

## Notes

- Works best on modern mobile browsers with `deviceorientation` support.
- iOS Safari requires permission to access motion and orientation data.
- Sound is generated with the Web Audio API.
