const ForkTSCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const HTMLWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    mode: 'development',
    entry: './src/index.tsx',
    output: {
        filename: 'index.js',
    },
    target: ['web', 'es2020'],
    module: {
        rules: [
            {
                test: /\.tsx?/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        transpileOnly: true,
                    },
                },
            },
        ],
    },
    resolve: {
        extensions: [".tsx", ".ts", ".js"],
    },
    plugins: [
        new ForkTSCheckerWebpackPlugin(),
        new HTMLWebpackPlugin({
            inject: 'body',
            template: './src/index.html',
        }),
    ],
    devServer: {
        port: 8001,
        server: 'spdy',
        client: {
            overlay: false,
        },
    },
};
