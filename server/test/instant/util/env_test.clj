(ns instant.util.env-test
  (:require [clojure.test :refer [deftest is testing]]
            [instant.util.env :as env]))

(deftest sidekick-name-test
  (is (= "SIDEKICK_BACKEND_URL" (env/sidekick-name "INSTANT_BACKEND_URL")))
  (is (= "SIDEKICK_CONFIG_S3_ENDPOINT" (env/sidekick-name "INSTANT_CONFIG_S3_ENDPOINT")))
  (testing "only INSTANT_ variables have a SIDEKICK_ name"
    (is (nil? (env/sidekick-name "DATABASE_URL")))
    (is (nil? (env/sidekick-name "NEXT_PUBLIC_INSTANT_APP_ID")))))

(deftest describe-test
  (is (= "SIDEKICK_BACKEND_URL (or INSTANT_BACKEND_URL)" (env/describe "INSTANT_BACKEND_URL")))
  (is (= "DATABASE_URL" (env/describe "DATABASE_URL"))))

(deftest lookup-test
  (testing "the INSTANT_ name still works"
    (is (= "old" (env/lookup {"INSTANT_BACKEND_URL" "old"} "INSTANT_BACKEND_URL"))))
  (testing "a variable can be set under its SIDEKICK_ name only"
    (is (= "new" (env/lookup {"SIDEKICK_BACKEND_URL" "new"} "INSTANT_BACKEND_URL"))))
  (testing "the SIDEKICK_ name wins when both are set"
    (is (= "new" (env/lookup {"INSTANT_BACKEND_URL" "old"
                              "SIDEKICK_BACKEND_URL" "new"}
                             "INSTANT_BACKEND_URL"))))
  (testing "a blank SIDEKICK_ value means unset"
    (is (= "old" (env/lookup {"INSTANT_BACKEND_URL" "old"
                              "SIDEKICK_BACKEND_URL" ""}
                             "INSTANT_BACKEND_URL")))
    (is (= "old" (env/lookup {"INSTANT_BACKEND_URL" "old"
                              "SIDEKICK_BACKEND_URL" "  "}
                             "INSTANT_BACKEND_URL")))
    (is (nil? (env/lookup {"SIDEKICK_BACKEND_URL" ""} "INSTANT_BACKEND_URL"))))
  (testing "unset"
    (is (nil? (env/lookup {} "INSTANT_BACKEND_URL"))))
  (testing "other variables are read as they are, and have no alias"
    (is (= "url" (env/lookup {"DATABASE_URL" "url"
                              "SIDEKICK_DATABASE_URL" "ignored"}
                             "DATABASE_URL")))
    (is (= "" (env/lookup {"S3_ENDPOINT" ""} "S3_ENDPOINT")))))

(deftest getenv-test
  (is (= (System/getenv "PATH") (env/getenv "PATH")))
  (is (nil? (env/getenv "INSTANT_ENV_TEST_UNSET_VARIABLE"))))
