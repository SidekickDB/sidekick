(ns instant.email-router-test
  (:require
   [clj-http.client :as clj-http]
   [clojure.test :refer [deftest is testing]]
   [instant.config :as config]
   [instant.email-router :as email-router]
   [instant.postmark :as postmark]
   [instant.sendgrid :as sendgrid]
   [instant.util.exception :as ex]
   [instant.util.json :refer [<-json]]
   [instant.util.test :refer [instant-ex-data]]))

(def ^:private letter
  {:from {:name "Sender" :email "login@example.com"}
   :to [{:email "user@example.com"}]
   :subject "subject"
   :html "<p>hi</p>"})

(deftest refuses-to-send-without-a-sender-when-a-provider-is-configured
  (let [sent (atom nil)]
    (with-redefs [config/email-send-enabled? (constantly true)
                  config/email-provider (constantly :postmark)
                  config/missing-email-sender-env-vars (constantly ["INSTANT_APP_EMAIL_SENDER_EMAIL"])
                  postmark/send-structured! #(reset! sent %)]
      (testing "a letter without a From address is refused, naming the missing sender"
        (let [err (instant-ex-data
                   (email-router/send-structured! (assoc-in letter [:from :email] nil)))]
          (is (= ::ex/email-send-failed (::ex/type err)))
          (is (re-find #"INSTANT_APP_EMAIL_SENDER_EMAIL" (::ex/message err)))
          (is (not (re-find #"INSTANT_DASHBOARD_EMAIL_SENDER_EMAIL" (::ex/message err)))))
        (is (nil? @sent)))

      (testing "a letter with a From address is sent"
        (email-router/send-structured! letter)
        (is (= letter @sent))))))

(deftest sends-without-a-sender-when-no-provider-is-configured
  ;; With no provider nothing leaves the server, so a missing sender is fine
  ;; (postmark/send-structured! only records that sending is disabled).
  (let [sent (atom nil)]
    (with-redefs [config/email-send-enabled? (constantly false)
                  config/email-provider (constantly nil)
                  config/resend-send-enabled? (constantly false)
                  config/sendgrid-send-enabled? (constantly false)
                  postmark/send-structured! #(reset! sent %)]
      (email-router/send-structured! (assoc-in letter [:from :email] nil))
      (is (some? @sent)))))

(deftest sendgrid-omits-reply-to-when-none-is-configured
  (let [body (atom nil)]
    (with-redefs [config/sendgrid-send-enabled? (constantly true)
                  config/sendgrid-token (constantly "token")
                  clj-http/post (fn [_url opts] (reset! body (<-json (:body opts))))]
      (testing "no reply-to configured"
        (with-redefs [config/email-reply-to (constantly nil)]
          (sendgrid/send! letter)
          (is (not (contains? @body "reply_to")))))

      (testing "explicit reply-to"
        (with-redefs [config/email-reply-to (constantly nil)]
          (sendgrid/send! (assoc letter :reply-to "reply@example.com"))
          (is (= {"email" "reply@example.com"} (get @body "reply_to")))))

      (testing "configured reply-to"
        (with-redefs [config/email-reply-to (constantly "ops@example.com")]
          (sendgrid/send! letter)
          (is (= {"email" "ops@example.com"} (get @body "reply_to"))))))))

(deftest postmark-omits-reply-to-when-none-is-configured
  (let [body (atom nil)]
    (with-redefs [config/postmark-send-enabled? (constantly true)
                  config/postmark-token (constantly "token")
                  clj-http/post (fn [_url opts] (reset! body (<-json (:body opts))))]
      (testing "no reply-to configured"
        (with-redefs [config/email-reply-to (constantly nil)]
          (postmark/send! {:from "Sender <login@example.com>" :to "user@example.com"
                           :subject "s" :html "<p>hi</p>"})
          (is (not (contains? @body "ReplyTo")))))

      (testing "configured reply-to"
        (with-redefs [config/email-reply-to (constantly "ops@example.com")]
          (postmark/send! {:from "Sender <login@example.com>" :to "user@example.com"
                           :subject "s" :html "<p>hi</p>"})
          (is (= "ops@example.com" (get @body "ReplyTo"))))))))
