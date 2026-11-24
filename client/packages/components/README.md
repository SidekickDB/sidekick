<!-- SidekickDB: plain-text header in place of upstream's logo, badges and links. -->

# @sidekickdb/components

Part of [SidekickDB](https://github.com/SidekickDB/sidekick), an independent continuation of the Apache-2.0 InstantDB code. It is not affiliated with or endorsed by Instant.

# SidekickDB Component Library

## Using the Explorer component

```tsx
import './App.css';
import { Explorer, Toaster } from '@sidekickdb/components';

function App() {
  return (
    <>
      <Explorer
        className="h-full"
        useShadowDOM
        darkMode={false}
        appId={import.meta.env.VITE_INSTANT_APP_ID}
        adminToken={import.meta.env.VITE_INSTANT_ADMIN_TOKEN}
        // URL of your SidekickDB server. Required: there is no default.
        apiURI={import.meta.env.VITE_INSTANT_API_URI}
      />
      <Toaster position="top-right" />
    </>
  );
}

export default App;
```

# Styles

### In www/

The tailwind installation in www/ already scans `./node_modules/@sidekickdb/components/src/**/*.{js,ts,jsx,tsx,md}'`, so all styles should work out of the box.

Most components are rexported in client/www/components/ui.tsx .

### In projects that use tailwind

Make sure you add `./node_modules/@sidekickdb/components/src/**/*.{js,ts,jsx,tsx,md}'` to the content field in your tailwind config.

### In projects that don't use Tailwind

To use the Explorer

```tsx
<Explorer
  className="h-full"
  useShadowDOM // this scopes and applies all styles with a shadow dom and script tag
  darkMode={false}
  apiURI={'http://localhost:8888'}
  websocketURI={'ws://localhost:8888/runtime/session'}
  appId="<your-app-id>"
  adminToken="<your-admin-token>"
/>
```

To use other components, you can wrap them in a <StyleMe> tag to mount them into a ShadowDOM.
However, doing this for most components is not practical so you can also import the styles separately.

```tsx
import '@sidekickdb/components/style.css';
```

In projects that don't use Tailwind it's recommended to just use the Explorer component with ShadowDOM and none of the other components.

# Development

Running the Vite Demo
`pnpm run dev:demo`

Runs on port 5173

## Environment Variables

Create a `.env` file in client/packages/components/.env

```
VITE_INSTANT_APP_ID=<your app id>
VITE_INSTANT_ADMIN_TOKEN=<your app id>
```

# Build System Notes

This package only uses Vite as the build system.
It builds to both esm modules and cjs.
In StyleMe (virtual dom wrapper util) the tailwind styles are compiled inline and placed in a style tag at the root of the virtual DOM.

Tried to use tshy, but there was no good story for bundling the css.
