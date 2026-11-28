(ns instant.email-router
  (:require
   [clojure.string :as string]
   [instant.config :as config]
   [instant.flags :as flags]
   [instant.postmark :as postmark]
   [instant.resend :as resend]
   [instant.sendgrid :as sendgrid]
   [instant.util.env :as env]
   [instant.util.exception :as ex]
   [instant.util.tracer :as tracer]))

(def sendgrid-froms
  {"verify@auth-pm.instantdb.com" "verify@auth-sg.instantdb.com"
   "verify@dash-pm.instantdb.com" "verify@auth-sg.instantdb.com"})

(defn missing-sender-message []
  (str "Email is configured on this server, but no sender address is set for "
       "this email. The server operator needs to set "
       (string/join ", " (map env/describe
                              (or (seq (config/missing-email-sender-env-vars))
                                  (vals config/email-sender-env-vars))))
       "."))

(defn assert-sender!
  "Refuses to hand mail without a From address to a real email provider. With
   no provider configured nothing is sent, so a missing sender is fine."
  [req]
  (when (and (config/email-send-enabled?)
             (string/blank? (-> req :from :email)))
    (tracer/record-info! {:name "email-router/missing-sender"
                          :attributes {:missing-env-vars
                                       (string/join ", " (config/missing-email-sender-env-vars))}})
    (ex/throw-email-send-failed! (missing-sender-message))))

;; SidekickDB: the provider decision is its own function, so that callers can
;; ask which provider a letter from `from-email` goes through (custom sender
;; addresses need Postmark, see instant.model.app-email-sender).
(defn provider
  "Which provider send-structured! uses for a letter from `from-email`:
   :resend, :sendgrid, :sendgrid-hosted or :postmark."
  [from-email]
  (cond
    ;; Explicit provider override (self-hosted)
    (= :resend (config/email-provider))
    :resend

    (= :sendgrid (config/email-provider))
    :sendgrid

    (= :postmark (config/email-provider))
    :postmark

    ;; Auto-detect: Resend configured and others not
    (and (config/resend-send-enabled?)
         (not (config/postmark-send-enabled?))
         (not (config/sendgrid-send-enabled?)))
    :resend

    ;; Auto-detect: SendGrid configured and Postmark not — route through
    ;; SendGrid using the operator's own from-address.
    (and (config/sendgrid-send-enabled?)
         (not (config/postmark-send-enabled?)))
    :sendgrid

    ;; Hosted: gated by the feature flag, and only for the known Instant
    ;; from-addresses that have a SendGrid equivalent.
    (and (flags/send-with-sendgrid?)
         (contains? sendgrid-froms from-email))
    :sendgrid-hosted

    :else
    :postmark))

(defn send-structured! [req]
  (assert-sender! req)
  (case (provider (-> req :from :email))
    :resend (resend/send! req)
    :sendgrid (sendgrid/send! req)
    :sendgrid-hosted (sendgrid/send! (update-in req [:from :email] sendgrid-froms))
    :postmark (postmark/send-structured! req)))
