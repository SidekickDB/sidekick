(ns instant.config
  (:require [clojure.string :as string]
            [clojure.tools.logging :as log]
            [instant.config-edn :as config-edn]
            [instant.util.crypt :as crypt-util]
            [instant.util.aws :as aws-util]
            [instant.util.email :as email]
            [instant.util.env :as env]
            [instant.aurora-config :as aurora-config]
            [lambdaisland.uri :as uri]
            [lambdaisland.uri.normalize :as normalize])
  (:import
   (com.google.crypto.tink KeysetHandle)
   (java.net InetAddress)
   (java.time ZoneId ZonedDateTime)
   (javax.crypto.spec SecretKeySpec)))

(defonce hostname
  (delay
    (try
      (.getHostName (InetAddress/getLocalHost))
      (catch Exception e
        (log/error "Error getting hostname" e)
        "unknown"))))

(def ^:dynamic *env*
  nil)

(defn non-blank-env
  "The environment variable's trimmed value, or nil when it is unset or blank.
   Compose files pass unset variables through as empty strings, so empty must
   mean unset."
  [var-name]
  (some-> (env/getenv var-name) string/trim not-empty))

(def staging-env (System/getenv "STAGING"))
(def prod-env (System/getenv "PRODUCTION"))

(defn get-env []
  (cond
    (some? *env*)                                 *env*
    ;; n.b. make sure this the staging check is first so that we can
    ;;      override it in the eb env vars
    (= "true" staging-env)                        :staging
    (= "true" prod-env)                           :prod
    (= "test" (System/getProperty "instant.env")) :test
    (= "true" (System/getenv "TEST"))             :test
    :else                                         :dev))

(defn prod? [] (= :prod (get-env)))

(defn dev? [] (= :dev (get-env)))

(defn test? [] (= :test (get-env)))

;; SidekickDB runtime mode. INSTANT_RUNTIME_MODE (or SIDEKICK_RUNTIME_MODE,
;; which wins) is "self-hosted" or "default". The self-hosting compose files
;; and server/Dockerfile.self-hosted set "self-hosted"; anything else that
;; starts the server, including development and the tests, leaves it unset,
;; which means "default": today's behaviour. get-env is not affected, so a
;; self-hosted server still runs as :dev and none of the :prod or :staging
;; (AWS) paths switch on. See server/test/instant/runtime_mode_test.clj.
(def runtime-modes #{"self-hosted" "default"})

(defn runtime-mode-value
  "The configured runtime mode, trimmed and lower-cased, or nil when unset."
  []
  (some-> (env/getenv "INSTANT_RUNTIME_MODE") string/trim not-empty string/lower-case))

(defn self-hosted?
  "True in the self-hosted runtime mode."
  []
  (= "self-hosted" (runtime-mode-value)))

(defn dev-only?
  "True for behaviour meant only for developing the server itself: :dev, but
   not a self-hosted server, which also runs as :dev."
  []
  (and (dev?) (not (self-hosted?))))

;; SidekickDB: how long `instant.core/stop` spreads the closing of WebSockets
;; over. INSTANT_SHUTDOWN_DRAIN_SECONDS (or SIDEKICK_SHUTDOWN_DRAIN_SECONDS)
;; sets it in any mode. Unset, a self-hosted server drains for 20 s, and nil
;; leaves upstream's drain (1 s in :dev, 4 minutes otherwise) to the caller.
(def default-self-hosted-drain-seconds 20)

(defn shutdown-drain-opts []
  (let [value (non-blank-env "INSTANT_SHUTDOWN_DRAIN_SECONDS")
        seconds (some-> value parse-long)
        seconds (cond
                  (and seconds (<= 0 seconds)) seconds
                  value (do (log/warn (env/describe "INSTANT_SHUTDOWN_DRAIN_SECONDS")
                                      "is" (pr-str value)
                                      "but must be a whole number of seconds; using the default")
                            nil))]
    (when-let [seconds (or seconds
                           (when (self-hosted?) default-self-hosted-drain-seconds))]
      {:total-ms (* 1000 seconds)
       :max-gap-ms 1000})))

(defn runtime-mode-errors
  "Problems with the runtime mode setting, as messages. Empty when it is fine."
  []
  (let [v (runtime-mode-value)]
    (cond
      (and v (not (contains? runtime-modes v)))
      [(str (env/describe "INSTANT_RUNTIME_MODE") " is \"" v "\". "
            "Use \"self-hosted\" or \"default\", or leave it unset.")]

      (and (= "self-hosted" v) (#{:prod :staging} (get-env)))
      [(str (env/describe "INSTANT_RUNTIME_MODE") " is \"self-hosted\", "
            "which cannot be combined with PRODUCTION=true or STAGING=true.")]

      :else [])))

(defn exit-on-startup-error?
  "Whether a startup error stops the process. Outside :dev it always does;
   in :dev only when the runtime mode is set to something other than
   \"default\" (a self-hosted server, or an invalid setting)."
  []
  (or (not= :dev (get-env))
      (not (contains? #{nil "default"} (runtime-mode-value)))))

(defn nrepl-enabled?
  "nREPL starts in the default mode, and in the self-hosted mode only when
   INSTANT_NREPL (or SIDEKICK_NREPL) is \"true\"."
  []
  (or (not (self-hosted?))
      (= "true" (some-> (env/getenv "INSTANT_NREPL") string/trim string/lower-case))))

(defn using-swarm? []
  (some? (System/getenv "SWARM_SERVICE_NAME")))

(defn aws-env? []
  (contains? #{:prod :staging} (get-env)))

(def use-logfmt? (aws-env?))

(def instant-config-app-id
  #uuid "24a4d71b-7bb2-4630-9aee-01146af26239")

(defn superuser-email
  "The self-hosted deployment operator's email (INSTANT_SUPERUSER_EMAIL),
   normalized. nil when unset (or blank), e.g. on the hosted deployment.
   Throws when set to something that isn't a valid email."
  []
  (when-let [value (some-> (env/getenv "INSTANT_SUPERUSER_EMAIL")
                           string/trim
                           not-empty)]
    (or (email/coerce value)
        (throw (ex-info
                (str (env/describe "INSTANT_SUPERUSER_EMAIL")
                     " must be a valid email address.")
                {:value value})))))

(defonce instance-id
  (delay
    (when (aws-env?)
      (aws-util/get-instance-id))))

(defonce machine-id (random-uuid))

(defonce process-id
  (delay
    (string/replace
     (string/join "_"
                  [(name (get-env))
                   (or @instance-id
                       (crypt-util/random-hex 8))
                   (crypt-util/random-hex 8)])
     #"-" "_")))

(def config-map
  (delay (do
           ;; init-hybrid because we might need it to decrypt the config
           (crypt-util/init-hybrid)
           (crypt-util/register-signature)

           (config-edn/decrypted-config crypt-util/obfuscate
                                        crypt-util/get-hybrid-decrypt-primitive
                                        crypt-util/hybrid-decrypt
                                        (aws-env?)
                                        (config-edn/read-config (get-env))))))

(def rate-limit-hmac-secret
  (delay (SecretKeySpec. (or (some-> @config-map
                                     :rate-limit-hmac-key
                                     crypt-util/secret-value
                                     crypt-util/hex-string->bytes)
                             (crypt-util/random-bytes 32))
                         "HmacSHA256")))

(defn s3-storage-access-key []
  (some-> @config-map :s3-storage-access-key crypt-util/secret-value))

(defn s3-storage-secret-key []
  (some-> @config-map :s3-storage-secret-key crypt-util/secret-value))

(defn s3-endpoint []
  (or (System/getenv "S3_ENDPOINT")
      (some-> @config-map :s3-endpoint)))

(defn s3-public-endpoint []
  (or (System/getenv "S3_PUBLIC_ENDPOINT")
      (some-> @config-map :s3-public-endpoint)
      (s3-endpoint)))

(defn s3-region []
  (or (System/getenv "AWS_REGION")
      (some-> @config-map :s3-region)
      "us-east-1"))

(defn postmark-token []
  (or (non-blank-env "POSTMARK_TOKEN")
      (some-> @config-map :postmark-token crypt-util/secret-value)))

(defn sendgrid-token []
  (or (non-blank-env "SENDGRID_TOKEN")
      (some-> @config-map :sendgrid-token crypt-util/secret-value)))

(defn resend-token []
  (or (non-blank-env "RESEND_TOKEN")
      (non-blank-env "RESEND_API_KEY")
      (some-> @config-map :resend-token crypt-util/secret-value)))

(defn postmark-account-token []
  (or (non-blank-env "POSTMARK_ACCOUNT_TOKEN")
      (some-> @config-map :postmark-account-token crypt-util/secret-value)))

;; Sender and reply-to addresses have no defaults: we must never send mail as
;; someone else's domain. When a provider is configured but a sender is not,
;; sends that need that sender fail (see instant.email-router) and the server
;; warns at boot (see `startup-warnings`).
(defn email-reply-to []
  (non-blank-env "INSTANT_EMAIL_REPLY_TO"))

(def email-sender-env-vars
  {:dashboard "INSTANT_DASHBOARD_EMAIL_SENDER_EMAIL"
   :app "INSTANT_APP_EMAIL_SENDER_EMAIL"
   :team "INSTANT_TEAM_EMAIL_SENDER_EMAIL"})

(defn dashboard-email-sender []
  ;; SidekickDB: the default sender name is SidekickDB (upstream: Instant).
  {:name (or (non-blank-env "INSTANT_DASHBOARD_EMAIL_SENDER_NAME")
             "SidekickDB")
   :email (non-blank-env (:dashboard email-sender-env-vars))})

(defn app-email-sender []
  {:name (non-blank-env "INSTANT_APP_EMAIL_SENDER_NAME")
   :email (non-blank-env (:app email-sender-env-vars))})

(defn team-email-sender []
  ;; SidekickDB: the default sender name is SidekickDB (upstream: Instant).
  {:name (or (non-blank-env "INSTANT_TEAM_EMAIL_SENDER_NAME")
             "SidekickDB")
   :email (non-blank-env (:team email-sender-env-vars))})

(defn email-provider
  "Explicit email-provider override for self-hosted deployments
   (INSTANT_EMAIL_PROVIDER = \"postmark\" | \"sendgrid\" | \"resend\"). Wins over token
   auto-detection when set. nil when unset."
  []
  (some-> (env/getenv "INSTANT_EMAIL_PROVIDER")
          string/trim
          string/lower-case
          not-empty
          keyword))

(defn resend-send-enabled? []
  (not (string/blank? (resend-token))))

(defn sendgrid-send-enabled? []
  (not (string/blank? (sendgrid-token))))

(defn postmark-send-enabled? []
  (not (string/blank? (postmark-token))))

(defn email-send-enabled?
  "True when any email provider has a token, i.e. mail will really be sent."
  []
  (or (resend-send-enabled?)
      (sendgrid-send-enabled?)
      (postmark-send-enabled?)))

(defn missing-email-sender-env-vars
  "Sender env vars that are unset while an email provider is configured."
  []
  (when (email-send-enabled?)
    (let [senders {:dashboard (dashboard-email-sender)
                   :app (app-email-sender)
                   :team (team-email-sender)}]
      (vec (for [[k env-var] email-sender-env-vars
                 :when (nil? (:email (get senders k)))]
             env-var)))))

(defn postmark-admin-enabled? []
  (not (string/blank? (postmark-account-token))))

(defn secret-discord-token []
  (some-> @config-map :secret-discord-token crypt-util/secret-value))

(defn discord-enabled? []
  (not (string/blank? (secret-discord-token))))

(def discord-signups-channel-id
  "1235663275144908832")

(def discord-teams-channel-id
  "1196584090552512592")

(def discord-debug-channel-id
  "1235659966627582014")

(def discord-errors-channel-id
  "1235713531018612896")

(def instant-on-instant-app-id
  (when-let [app-id (env/getenv "INSTANT_ON_INSTANT_APP_ID")]
    (parse-uuid app-id)))

(def webhook-signing-key* (delay (-> @config-map
                                     :webhook-keyset
                                     crypt-util/decode-keyset-handle)))

(defn webhook-signing-key ^KeysetHandle []
  @webhook-signing-key*)

(def webhook-public-key* (delay (-> (webhook-signing-key)
                                    (.getPublicKeysetHandle))))

(defn webhook-public-key ^KeysetHandle []
  @webhook-public-key*)

(defn db-url->config [url]
  (cond (string/starts-with? url "jdbc")
        {:jdbcUrl url}

        (string/starts-with? url "postgresql")
        (let [{:keys [user password host port path]} (uri/parse url)]
          {:dbtype "postgres"
           :dbname (if (string/starts-with? path "/")
                     (subs path 1)
                     path)
           :user user
           :password (normalize/percent-decode password)
           :host host
           :port (when port
                   (Integer/parseInt port))})

        :else
        (throw (Exception. "Invalid database connection string. Expected either a JDBC url or a postgres url."))))

(defn aurora-config-from-database-url []
  (let [url (or (System/getenv "DATABASE_URL")
                (some-> @config-map :database-url crypt-util/secret-value)
                "jdbc:postgresql://localhost:5432/instant")]
    (db-url->config url)))

(defn aurora-config-from-cluster-id [application-name]
  (when-let [cluster-id (or (System/getenv "DATABASE_CLUSTER_ID")
                            (some-> @config-map :database-cluster-id))]
    (aurora-config/rds-cluster-id->db-config cluster-id application-name)))

(defn db-application-name []
  (uri/query-encode (format "%s, %s"
                            @hostname
                            @process-id)))

(defn get-aurora-config []
  (let [application-name (db-application-name)
        config (or (aurora-config-from-cluster-id application-name)
                   (aurora-config-from-database-url))]
    (assoc config
           :ApplicationName application-name)))

(defn next-aurora-config-from-cluster-id [application-name]
  (when-let [cluster-id (or (System/getenv "NEXT_DATABASE_CLUSTER_ID")
                            (some-> @config-map :next-database-cluster-id))]
    (aurora-config/rds-cluster-id->db-config cluster-id application-name)))

(defn next-aurora-config-from-database-url []
  (when-let [url (or (System/getenv "NEXT_DATABASE_URL")
                     (some-> @config-map :next-database-url crypt-util/secret-value))]
    (db-url->config url)))

(defn get-next-aurora-config []
  (let [application-name (db-application-name)]
    (when-let [config (or (next-aurora-config-from-cluster-id application-name)
                          (next-aurora-config-from-database-url))]
      (assoc config
             :ApplicationName application-name))))

(defn dashboard-origin
  ([] (dashboard-origin {:env (get-env)}))
  ([{:keys [env]}]
   (or (env/getenv "INSTANT_DASHBOARD_URL")
       (case env
         :prod "https://www.instantdb.com"
         :staging "https://staging.instantdb.com"
         "http://localhost:3000"))))

;; The load-balancer listener's SNS topic and SQS queue prefix have no
;; defaults: we must never subscribe to a topic in someone else's AWS
;; account. When either is unset the listener doesn't start.
(def instance-events-sns-topic-arn
  (non-blank-env "INSTANCE_EVENTS_SNS_TOPIC_ARN"))

(def instance-events-sqs-queue-arn-prefix
  (non-blank-env "INSTANCE_EVENTS_SQS_TOPIC_ARN_PREFIX"))

(defn loadbalancer-listener-configured? []
  (boolean (and instance-events-sns-topic-arn
                instance-events-sqs-queue-arn-prefix)))

;; ---
;; Stripe
(defn stripe-secret []
  ;; Add an override from the environment because we need
  ;; it for the tests (populated at https://github.com/jsventures/instant/settings/secrets/actions)
  (let [env-secret (System/getenv "STRIPE_API_KEY")]
    (or (when-not (string/blank? env-secret) env-secret)
        (some-> @config-map :stripe-secret crypt-util/secret-value))))

(defn default-paid-app? []
  (string/blank? (stripe-secret)))

(defn stripe-webhook-secret []
  (-> @config-map :stripe-webhook-secret crypt-util/secret-value))

(defn stripe-return-url [type obj-id]
  (case type
    :app (str (dashboard-origin)
              "/dash?t=billing&app="
              obj-id)
    :org (str (dashboard-origin)
              "/dash/org?tab=billing&org="
              obj-id)))

(def test-pro-subscription "price_1P4ocVL5BwOwpxgU8Fe6oRWy")
(def prod-pro-subscription "price_1P4nokL5BwOwpxgUpWoidzdL")
(defn stripe-pro-subscription
  ([] (stripe-pro-subscription {:env (get-env)}))
  ([{:keys [env]}]
   (case env
     :prod prod-pro-subscription
     test-pro-subscription)))

(def test-startup-subscription "price_1RvkYbL5BwOwpxgUoDyhZtzN")
(def prod-startup-subscription "price_1RvkPZL5BwOwpxgUSVW7f2dd")
(defn stripe-startup-subscription
  ([] (stripe-startup-subscription {:env (get-env)}))
  ([{:keys [env]}]
   (case env
     :prod prod-startup-subscription
     test-startup-subscription)))

(defn get-honeycomb-api-key []
  (some-> @config-map :honeycomb-api-key crypt-util/secret-value))

(defn get-honeycomb-endpoint []
  (or (System/getenv "HONEYCOMB_ENDPOINT")
      "https://api.honeycomb.io:443"))

;; ---
;; PostHog
(defn get-posthog-api-key []
  (some-> @config-map :posthog-api-key crypt-util/secret-value))

(defn posthog-enabled? []
  (not (string/blank? (get-posthog-api-key))))

(defn get-google-oauth-client
  ([]
   (get-google-oauth-client
    (env/getenv "INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_ID")
    (env/getenv "INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_SECRET")))
  ([client-id client-secret]
   (cond
     (every? string/blank? [client-id client-secret])
     (-> @config-map :google-oauth-client)

     (some string/blank? [client-id client-secret])
     (throw (ex-info (str (env/describe "INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_ID") " and "
                          (env/describe "INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_SECRET")
                          " must be set together")
                     {}))

     :else
     {:client-id client-id
      :client-secret (crypt-util/obfuscate client-secret)})))

(defn dashboard-google-oauth-configured?
  "True when dashboard Google sign-in has a client, from the environment or the
   config file."
  []
  (some? (get-google-oauth-client)))

;; DNS-over-HTTPS resolvers for the SSRF-guarded HTTP client (webhooks, OAuth
;; discovery and JWKS). INSTANT_DNS_OVER_HTTPS_URLS is a comma-separated list of
;; DoH endpoints, or "system" to use the system resolver only.
(def default-dns-over-https-urls
  ["https://cloudflare-dns.com/dns-query"
   "https://dns.google/dns-query"])

(defn parse-dns-over-https-urls
  "nil or blank means the defaults; \"system\" means no DoH (empty vector).
   Only the literal \"system\" selects the system resolver: a value with no
   endpoints in it, such as \",\", is rejected instead of silently turning
   DoH off."
  [value]
  (let [value (some-> value string/trim not-empty)]
    (cond
      (nil? value) default-dns-over-https-urls
      (= "system" (string/lower-case value)) []
      :else (let [urls (->> (string/split value #",")
                            (map string/trim)
                            (remove string/blank?)
                            vec)]
              (when (empty? urls)
                (throw (ex-info (str (env/describe "INSTANT_DNS_OVER_HTTPS_URLS")
                                     " has no DNS-over-HTTPS URL in it: "
                                     (pr-str value)
                                     ". Use a comma-separated list of URLs, or \"system\".")
                                {:value value})))
              urls))))

(defn dns-over-https-urls []
  (parse-dns-over-https-urls (env/getenv "INSTANT_DNS_OVER_HTTPS_URLS")))

(defn shared-oauth-clients []
  (-> @config-map :shared-oauth-clients))

;; Buckets have no defaults outside of tests. S3 bucket names are global, so a
;; default name would point at a bucket in someone else's AWS account.
(def s3-bucket-name
  (or (non-blank-env "S3_BUCKET")
      (when (= :test (get-env))
        "instantdb-test-bucket")))

;; nil means WAL history is stored in postgres.
(def s3-wal-history-bucket-name
  (when-not (= "pg" (System/getenv "WAL_HISTORY_STORAGE"))
    (non-blank-env "WAL_HISTORY_BUCKET_NAME")))

;; nil means app backups are disabled.
(def s3-app-backups-bucket-name
  (or (non-blank-env "S3_APP_BACKUPS_BUCKET")
      (when (= :test (get-env))
        "instantdb-test-app-backups")))

(def app-backups-not-configured-message
  (str "Backups are not configured on this server. Set S3_APP_BACKUPS_BUCKET "
       "to an existing S3 bucket and restart the server."))

(defn app-backups-enabled? []
  (some? s3-app-backups-bucket-name))

(defn startup-warnings
  "Configuration problems that should be logged loudly when the server boots."
  []
  (cond-> []
    (nil? s3-bucket-name)
    (conj "S3_BUCKET is not set. File storage will fail until it is set.")

    (not (app-backups-enabled?))
    (conj "S3_APP_BACKUPS_BUCKET is not set. App backups are disabled.")

    (not (email-send-enabled?))
    (conj (str "No email provider is configured. Emails are not sent; "
               "dashboard login codes are printed to this log."))

    (seq (missing-email-sender-env-vars))
    (conj (str "An email provider is configured, but "
               (string/join ", " (map env/describe (missing-email-sender-env-vars)))
               " is not set. Emails from that sender will fail until it is set."))))

(def wal-history-prefix
  (when (= :dev (get-env))
    @hostname))

(def cloudfront-s3-url
  (case (get-env)
    :prod {"instant-storage" "https://files.instantdb.com"}
    :dev {"instantdb-test-bucket" "https://files-dev.instantdb.com"}
    :staging {"instant-storage-staging" "https://files-staging.instantdb.com"}
    {}))

(def cloudfront-signing-key
  (delay (when-let [{:keys [key-id private-key]} (-> @config-map
                                                     :cloudfront-signing-key)]
           {:key-id key-id
            :private-key (-> private-key
                             crypt-util/secret-value
                             crypt-util/cloudfront-key-from-bytes)})))

(defn get-connection-pool-size []
  (or (some-> (System/getenv "CONNECTION_POOL_SIZE")
              (parse-long))
      (case (get-env)
        (:prod :staging) 400
        20)))

(defn env-integer [var-name]
  (when-let [envvar (System/getenv var-name)]
    (Integer/parseInt envvar)))

(defn get-server-port []
  (or (env-integer "PORT")
      (env-integer "BEANSTALK_PORT")
      (if-not (= :test (get-env))
        8888
        8886)))

(defn get-server-ssl-port []
  (or (env-integer "SSL_PORT")
      (if-not (= :test (get-env))
        8889
        8887)))

(def server-origin
  (or (env/getenv "INSTANT_BACKEND_URL")
      (case (get-env)
        :prod "https://api.instantdb.com"
        :staging "https://api-staging.instantdb.com"
        (str "http://localhost:" (get-server-port)))))

(defn secure-cookies?
  "Whether cookies the server sets are marked Secure. Upstream: outside :dev.
   Self-hosted: when the server is reached over https (INSTANT_BACKEND_URL),
   so a plain-http deployment keeps working."
  []
  (if (self-hosted?)
    (string/starts-with? (string/lower-case (str server-origin)) "https:")
    (not= :dev (get-env))))

(defn get-nrepl-port []
  (or (env-integer "NREPL_PORT") 6005))

(defn get-hz-port []
  (if-let [env-port (env-integer "HZ_PORT")]
    ;; In prod, HZ_PORT must be 5701-5708 (AWS default range)
    (if (or (= :dev (get-env))
            (<= 5701 env-port 5708))
      env-port
      (do
        (log/error "Invalid HZ_PORT" env-port)
        5701))
    5701))

(def grpc-port-offset 100)

(defn get-grpc-server-port []
  (+ (get-hz-port) grpc-port-offset))

(defn get-nrepl-bind-address []
  (or (System/getenv "NREPL_BIND_ADDRESS")
      (case (get-env)
        (:prod :staging) "0.0.0.0"
        nil)))

;; Should be increased by 1 every time we move the slot to a new
;; machine. This gives us a way to have a consistent ordering of LSNs
;; across database upgrades.
(def invalidator-slot-num 2)

;; Cuts off when the calendar turns to March in every time zone on Earth
(def free-teams-cutoff (-> (ZonedDateTime/of 2026 3 1 0 0 0 0 (ZoneId/of "Etc/GMT+12"))
                           (.toInstant)))

(defn pg-lock-ns
  "Creates a unique namespace for a pg advisory lock."
  [k]
  (int (case k
         :webhook 1
         :webhook-config 2)))

;; SidekickDB: the default weight limit of each app's datalog query cache
;; (reactive/store.clj). Upstream fixes it at 500 MiB, most of the heap the
;; self-hosted stack gives the server. INSTANT_QUERY_CACHE_MAX_BYTES sets it;
;; unset, it is a quarter of the maximum heap, at most upstream's 500 MiB.
(def upstream-query-cache-max-bytes (* 1024 1024 500))

(defn parse-query-cache-max-bytes
  "The limit in bytes. `value` is a positive number of bytes, optionally with a
   k, m or g suffix (powers of 1024); nil or blank means a quarter of
   `max-heap`, at most 500 MiB."
  [value max-heap]
  (if-let [value (some-> value string/trim not-empty)]
    (let [[_ n unit] (re-matches #"(?i)(\d{1,18})([kmg]?)" value)
          bytes (some-> n
                        parse-long
                        (*' (case (string/lower-case unit)
                              "" 1
                              "k" 1024
                              "m" (* 1024 1024)
                              "g" (* 1024 1024 1024))))]
      (when-not (and bytes (pos? bytes) (<= bytes Long/MAX_VALUE))
        (throw (ex-info (str (env/describe "INSTANT_QUERY_CACHE_MAX_BYTES")
                             " is " (pr-str value) ". Use a positive number of"
                             " bytes, optionally with a k, m or g suffix (512m).")
                        {:value value})))
      (long bytes))
    (min (quot max-heap 4) upstream-query-cache-max-bytes)))

(defn query-cache-max-bytes []
  (parse-query-cache-max-bytes (env/getenv "INSTANT_QUERY_CACHE_MAX_BYTES")
                               (Runtime/.maxMemory (Runtime/getRuntime))))

(defn init []
  (when-let [errors (seq (runtime-mode-errors))]
    (throw (ex-info (string/join " " errors) {:runtime-mode (runtime-mode-value)})))
  ;; SidekickDB: fail at startup on an invalid query cache size
  (query-cache-max-bytes)
  ;; instantiate the config-map so we can fail early if it's not
  ;; valid
  (let [config @config-map]
    (get-google-oauth-client)
    config))

(defonce fewer-vfutures? true)
