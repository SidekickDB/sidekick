(ns instant.config-test
  (:require [clojure.java.io :as io]
            [clojure.test :refer [deftest is testing]]
            [instant.config :as config]
            [instant.util.crypt :as crypt-util]))

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
    (when-not (System/getenv "INSTANT_EMAIL_REPLY_TO")
      (is (nil? (config/email-reply-to))))
    (when-not (System/getenv "INSTANT_DASHBOARD_EMAIL_SENDER_EMAIL")
      (is (nil? (:email (config/dashboard-email-sender)))))
    (when-not (System/getenv "INSTANT_APP_EMAIL_SENDER_EMAIL")
      (is (nil? (:email (config/app-email-sender)))))
    (when-not (System/getenv "INSTANT_TEAM_EMAIL_SENDER_EMAIL")
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
      (is (some #(re-find #"INSTANT_DASHBOARD_EMAIL_SENDER_EMAIL is not set" %)
                (config/startup-warnings))))))
