# Motion intent

- Button/hover/focus state: user-triggered color and border change, 120ms; communicates interactivity. Reduced motion is instantaneous.
- Existing brand loader: preserve authored outline during actual loading only. Existing static reduced-motion fallback remains; app-wide reduce disables CSS animation.
- Readiness Progress: static known percentage; never an invented elapsed-job percentage.
- Route/card entrances and lifting removed. Native document scrolling; no smooth-scroll or decorative animation added.
