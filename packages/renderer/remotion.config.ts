import { Config } from "@remotion/cli/config";

// Shared packages use Node ESM-style .js specifiers while shipping TypeScript source.
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: { ...config.resolve?.extensionAlias, ".js": [".js", ".ts", ".tsx"] },
  },
}));
