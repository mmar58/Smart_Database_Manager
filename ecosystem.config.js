module.exports = {
    apps: [{
        name: "db_manager",
        script: "./src/server.js",
        watch: false,
        env: {
            PORT: 3333,
            CORS_ORIGIN: "*",
            DB_CONNECTION_TIMEOUT: 60000,
            DB_ACQUIRE_TIMEOUT: 60000,
            MAX_ROWS_PER_PAGE: 1000,
            DEFAULT_PAGE_SIZE: 100,
            JWT_SECRET_KEY: "hardPasswordToGet"
        }
    }]
};
