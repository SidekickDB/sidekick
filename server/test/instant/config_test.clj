(ns instant.config-test
  (:require [clojure.java.io :as io]
            [clojure.test :refer [deftest is testing]]
            [instant.config :as config]
            [instant.util.crypt :as crypt-util]
            [instant.util.env :as env]))

(deftest google-oauth-client-test
  (let [config-client {:client-id "config-client-id"
                       :client-secret (crypt-util/obfuscate "config-client-secret")}]
    (with-redefs [config/config-map (delay {:google-oauth-client config-client})]
      (testing "uses the existing config when environment variables are blank"
        (is (= config-client (config/get-google-oauth-client nil nil)))
        (is (= config-client (config/get-google-oauth-client "" " "))))

      (testing "environment variables override the existing config"
        (let [client (config/get-google-oauth-client "env-client-id" "env-client-secret")]
          (is (= "env-client-id" (:client-id client)))
          (is (= "env-client-secret"
                 (crypt-util/secret-value (:client-secret client))))))

      (testing "both environment variables are required"
        (is (thrown-with-msg?
             clojure.lang.ExceptionInfo
             #"must be set together"
             (config/get-google-oauth-client "env-client-id" nil)))
        (is (thrown-with-msg?
             clojure.lang.ExceptionInfo
             #"must be set together"
             (config/get-google-oauth-client nil "env-client-secret")))))))

(deftest non-blank-env-test
  (is (nil? (config/non-blank-env "SIDEKICK_CONFIG_TEST_UNSET_VARIABLE")))
  (is (= (System/getenv "PATH") (config/non-blank-env "PATH"))))

(deftest sidekick-env-names-test
  (let [vars {"SIDEKICK_EMAIL_REPLY_TO" "new@example.com"
              "INSTANT_EMAIL_REPLY_TO" "old@example.com"
              "INSTANT_EMAIL_PROVIDER" "Resend"
              "SIDEKICK_DNS_OVER_HTTPS_URLS" "system"
              "SIDEKICK_APP_EMAIL_SENDER_NAME" "  "
              "INSTANT_APP_EMAIL_SENDER_NAME" "Old name"}]
    (with-redefs [env/getenv (partial env/lookup vars)]
      (testing "the SIDEKICK_ name wins"
        (is (= "new@example.com" (config/email-reply-to))))
      (testing "the INSTANT_ name still works"
        (is (= :resend (config/email-provider))))
      (testing "a variable set only under its SIDEKICK_ name"
        (is (= [] (config/dns-over-https-urls))))
      (testing "a blank SIDEKICK_ value falls back to the INSTANT_ one"
        (is (= "Old name" (:name (config/app-email-sender))))))))

(deftest no-instant-aws-account-fallbacks-test
  (testing "config has no resources in Instant's AWS account as defaults"
    (is (not (re-find #"597134865416"
                      (slurp (io/resource "instant/config.clj"))))))

  (testing "the load-balancer listener is off unless its topic and queue are set"
    (when-not (or (System/getenv "INSTANCE_EVENTS_SNS_TOPIC_ARN")
                  (System/getenv "INSTANCE_EVENTS_SQS_TOPIC_ARN_PREFIX"))
      (is (nil? config/instance-events-sns-topic-arn))
      (is (nil? config/instance-events-sqs-queue-arn-prefix))
      (is (false? (config/loadbalancer-listener-configured?)))))

  (testing "WAL history has no default bucket"
    (when-not (System/getenv "WAL_HISTORY_BUCKET_NAME")
      (is (nil? config/s3-wal-history-bucket-name)))))

(deftest no-instant-email-identities-test
  (testing "config has no instantdb.com email addresses as defaults"
    (is (not (re-find #"@[\w.-]*instantdb\.com"
                      (slurp (io/resource "instant/config.clj"))))))

  (testing "senders and reply-to are unset unless configured"
    (when-not (env/getenv "INSTANT_EMAIL_REPLY_TO")
      (is (nil? (config/email-reply-to))))
    (when-not (env/getenv "INSTANT_DASHBOARD_EMAIL_SENDER_EMAIL")
      (is (nil? (:email (config/dashboard-email-sender)))))
    (when-not (env/getenv "INSTANT_APP_EMAIL_SENDER_EMAIL")
      (is (nil? (:email (config/app-email-sender)))))
    (when-not (env/getenv "INSTANT_TEAM_EMAIL_SENDER_EMAIL")
      (is (nil? (:email (config/team-email-sender)))))))

(deftest missing-email-sender-env-vars-test
  (with-redefs [config/dashboard-email-sender (constantly {:name "D" :email "login@example.com"})
                config/app-email-sender (constantly {:name nil :email nil})
                config/team-email-sender (constantly {:name "T" :email nil})]
    (testing "nothing is missing when no provider is configured"
      (with-redefs [config/email-send-enabled? (constantly false)]
        (is (empty? (config/missing-email-sender-env-vars)))))

    (testing "unset senders are reported when a provider is configured"
      (with-redefs [config/email-send-enabled? (constantly true)]
        (is (= ["INSTANT_APP_EMAIL_SENDER_EMAIL"
                "INSTANT_TEAM_EMAIL_SENDER_EMAIL"]
               (config/missing-email-sender-env-vars)))))))

(deftest startup-warnings-test
  (testing "no warnings when everything is configured"
    (with-redefs [config/s3-bucket-name "storage"
                  config/s3-app-backups-bucket-name "backups"
                  config/email-send-enabled? (constantly true)
                  config/missing-email-sender-env-vars (constantly [])]
      (is (= [] (config/startup-warnings)))))

  (testing "unset buckets and missing email config are reported"
    (with-redefs [config/s3-bucket-name nil
                  config/s3-app-backups-bucket-name nil
                  config/email-send-enabled? (constantly false)]
      (let [warnings (config/startup-warnings)]
        (is (some #(re-find #"S3_BUCKET is not set" %) warnings))
        (is (some #(re-find #"S3_APP_BACKUPS_BUCKET is not set" %) warnings))
        (is (some #(re-find #"No email provider is configured" %) warnings)))))

  (testing "a provider without a sender is reported"
    (with-redefs [config/email-send-enabled? (constantly true)
                  config/missing-email-sender-env-vars
                  (constantly ["INSTANT_DASHBOARD_EMAIL_SENDER_EMAIL"])]
      (is (some #(re-find #"SIDEKICK_DASHBOARD_EMAIL_SENDER_EMAIL \(or INSTANT_DASHBOARD_EMAIL_SENDER_EMAIL\) is not set" %)
                (config/startup-warnings))))))

(deftest dashboard-google-oauth-configured-test
  (with-redefs [config/get-google-oauth-client (constantly nil)]
    (is (false? (config/dashboard-google-oauth-configured?))))
  (with-redefs [config/get-google-oauth-client (constantly {:client-id "id"})]
    (is (true? (config/dashboard-google-oauth-configured?)))))

(deftest parse-dns-over-https-urls-test
  (testing "unset or blank uses the defaults"
    (is (= config/default-dns-over-https-urls (config/parse-dns-over-https-urls nil)))
    (is (= config/default-dns-over-https-urls (config/parse-dns-over-https-urls "  "))))
  (testing "system means the system resolver only"
    (is (= [] (config/parse-dns-over-https-urls "system")))
    (is (= [] (config/parse-dns-over-https-urls " SYSTEM "))))
  (testing "a comma-separated list of endpoints"
    (is (= ["https://doh.example.com/dns-query"]
           (config/parse-dns-over-https-urls "https://doh.example.com/dns-query")))
    (is (= ["https://a.example/dns-query" "https://b.example/dns-query"]
           (config/parse-dns-over-https-urls
            " https://a.example/dns-query, ,https://b.example/dns-query "))))
  (testing "a value with no endpoint is rejected, not read as system"
    (is (thrown-with-msg? clojure.lang.ExceptionInfo
                          #"INSTANT_DNS_OVER_HTTPS_URLS"
                          (config/parse-dns-over-https-urls ",")))
    (is (thrown-with-msg? clojure.lang.ExceptionInfo
                          #"INSTANT_DNS_OVER_HTTPS_URLS"
                          (config/parse-dns-over-https-urls " , , ")))))

(deftest parse-query-cache-max-bytes-test
  (let [heap (* 1200 1024 1024)]
    (testing "unset or blank is a quarter of the heap"
      (is (= (* 300 1024 1024) (config/parse-query-cache-max-bytes nil heap)))
      (is (= (* 300 1024 1024) (config/parse-query-cache-max-bytes " " heap))))
    (testing "at most upstream's 500 MiB"
      (is (= (* 500 1024 1024)
             (config/parse-query-cache-max-bytes nil (* 2000 1024 1024))))
      (is (= (* 500 1024 1024)
             (config/parse-query-cache-max-bytes nil (* 8 1024 1024 1024))))
      (is (= (* 500 1024 1024)
             (config/parse-query-cache-max-bytes nil Long/MAX_VALUE))))
    (testing "a set value is not capped"
      (is (= (* 2 1024 1024 1024)
             (config/parse-query-cache-max-bytes "2g" (* 16 1024 1024 1024)))))
    (testing "bytes, or a k, m or g suffix"
      (is (= 1000 (config/parse-query-cache-max-bytes "1000" heap)))
      (is (= (* 64 1024) (config/parse-query-cache-max-bytes "64k" heap)))
      (is (= (* 512 1024 1024) (config/parse-query-cache-max-bytes " 512M " heap)))
      (is (= (* 2 1024 1024 1024) (config/parse-query-cache-max-bytes "2g" heap))))
    (testing "anything else is rejected"
      (doseq [v ["0" "0m" "-1" "1.5g" "512mb" "lots" "99999999999999g"]]
        (is (thrown-with-msg? clojure.lang.ExceptionInfo
                              #"SIDEKICK_QUERY_CACHE_MAX_BYTES"
                              (config/parse-query-cache-max-bytes v heap))
            v)))))

(deftest query-cache-max-bytes-test
  (testing "the SIDEKICK_ name wins"
    (with-redefs [env/getenv (partial env/lookup
                                      {"SIDEKICK_QUERY_CACHE_MAX_BYTES" "64m"
                                       "INSTANT_QUERY_CACHE_MAX_BYTES" "1g"})]
      (is (= (* 64 1024 1024) (config/query-cache-max-bytes)))))
  (testing "unset, a quarter of this JVM's heap, at most 500 MiB"
    (with-redefs [env/getenv (constantly nil)]
      (is (= (min (quot (Runtime/.maxMemory (Runtime/getRuntime)) 4)
                  (* 500 1024 1024))
             (config/query-cache-max-bytes))))))
