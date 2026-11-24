(ns instant.superadmin.routes-test
  (:require
   [clojure.test :refer [deftest is testing]]
   [instant.config :as config]
   [instant.core :as core]
   [instant.fixtures :refer [random-email with-empty-app with-user]]
   [instant.model.instant-personal-access-token :as instant-personal-access-token-model]
   [instant.resend :as resend]
   [instant.util.coll :as coll]
   [instant.util.json :refer [->json <-json]]
   [instant.util.tracer :as tracer])
  (:import
   (clojure.lang ExceptionInfo)
   (java.io ByteArrayInputStream)))

(defn request [opts]
  (with-redefs [tracer/*silence-exceptions?* (atom true)]
    (let [req (merge-with merge
                          {:headers {"content-type" "application/json"}
                           :request-method (:method opts)
                           :uri (:url opts)}
                          (-> opts
                              (coll/update-when :body (fn [body]
                                                        (ByteArrayInputStream. (.getBytes ^String (->json body) "UTF-8"))))))
          resp (-> ((core/handler) req)
                   (update :body (fn [body]
                                   (<-json body true))))]
      (if (not= 200 (:status resp))
        (throw (ex-info (str "status " (:status resp)) resp))
        resp))))

(defn get-app [app token]
  (request {:method :get
            :url (str "/superadmin/apps/" (:id app))
            :headers {"authorization" (str "Bearer " token)}}))

(deftest superadmin-app-details-auth
  (with-user
    (fn [u]
      (with-empty-app (:id u)
        (fn [app]
          (testing "user refresh token authenticates as the app owner"
            (let [resp (get-app app (:refresh-token u))]
              (is (= (str (:id app)) (-> resp :body :app :id)))))

          (testing "personal access token works"
            (let [{pat-id :id pat-token :token}
                  (instant-personal-access-token-model/create!
                   {:user-id (:id u) :name "test-pat"})]
              (try
                (let [resp (get-app app pat-token)]
                  (is (= (str (:id app)) (-> resp :body :app :id))))
                (finally
                  (instant-personal-access-token-model/delete-by-id!
                   {:id pat-id :user-id (:id u)})))))

          (testing "admin token works"
            (let [resp (get-app app (str (:admin-token app)))]
              (is (= (str (:id app)) (-> resp :body :app :id)))))

          (testing "unrelated user's refresh token is rejected"
            (with-user
              (fn [other]
                (is (thrown-with-msg? ExceptionInfo #"status 400"
                                      (get-app app (:refresh-token other))))))))))))

;; SidekickDB: the transfer invite uses this server's team sender and
;; dashboard URL and goes through email-router. Upstream sends it with
;; postmark/send! from teams@pm.instantdb.com with a link to instantdb.com.
(deftest app-transfer-invite-uses-the-configured-sender-and-provider
  (with-user
    (fn [u]
      (with-empty-app (:id u)
        (fn [app]
          ;; The transfer endpoints take a personal access token, not a
          ;; refresh token.
          (let [{pat-id :id pat-token :token}
                (instant-personal-access-token-model/create!
                 {:user-id (:id u) :name "test-pat"})
                send-transfer (fn [dest-email]
                                (request {:method :post
                                          :url (str "/superadmin/apps/" (:id app) "/transfers/send")
                                          :headers {"authorization" (str "Bearer " pat-token)}
                                          :body {:dest_email dest-email}}))]
            (try
              (testing "with only Resend configured, Resend gets the invite"
                (let [sent (atom nil)
                      dest-email (random-email)]
                  (with-redefs [config/email-send-enabled? (constantly true)
                                config/email-provider (constantly nil)
                                config/resend-send-enabled? (constantly true)
                                config/sendgrid-send-enabled? (constantly false)
                                config/postmark-send-enabled? (constantly false)
                                config/team-email-sender (constantly {:name "Team" :email "teams@example.com"})
                                config/dashboard-origin (constantly "https://dash.example.com")
                                resend/send! #(reset! sent %)]
                    (is (= 200 (:status (send-transfer dest-email)))))
                  (is (= {:name "Team" :email "teams@example.com"} (:from @sent)))
                  (is (= [{:email dest-email}] (:to @sent)))
                  (is (re-find #"https://dash\.example\.com/dash\?s=invites" (:html @sent)))
                  (is (not (re-find #"instantdb\.com" (:html @sent))))))

              (testing "without a team sender the invite is refused"
                (with-redefs [config/email-send-enabled? (constantly true)
                              config/team-email-sender (constantly {:name "Team" :email nil})]
                  (is (thrown-with-msg? ExceptionInfo #"status 500"
                                        (send-transfer (random-email))))))
              (finally
                (instant-personal-access-token-model/delete-by-id!
                 {:id pat-id :user-id (:id u)})))))))))
