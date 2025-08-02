import oneInchEslintConfig from "@1inch/eslint-config";

export default [...oneInchEslintConfig, {
    rules: {
        "no-console": "off",
    },
    files: ['tests/**/**']
}];
