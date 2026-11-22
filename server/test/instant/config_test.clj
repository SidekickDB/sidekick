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

(deftest startup-warnings-test
  (with-redefs [config/s3-bucket-name "storage"
                config/s3-app-backups-bucket-name "backups"]
    (is (= [] (config/startup-warnings))))

  (with-redefs [config/s3-bucket-name nil
                config/s3-app-backups-bucket-name nil]
    (let [warnings (config/startup-warnings)]
      (is (some #(re-find #"S3_BUCKET is not set" %) warnings))
      (is (some #(re-find #"S3_APP_BACKUPS_BUCKET is not set" %) warnings)))))
